import {createHash} from 'node:crypto';
import {
  AGENT_TOOLS_MCP_SERVER_ID,
  type AgentIntegrationMcpServerConfigDto,
  agentIntegrationMcpServerSchema,
  agentIntegrationMcpToolName,
  agentRepositoryContextConfigSchema,
  type ClaudeRuntimeConfigDto,
  type CustomModelProviderRuntimeConfigDto,
  type Harness,
  type MaterializedAgentMcpServerConfigDto,
  materializedAgentMcpServerSchema,
} from '@shipfox/api-agent-dto';
import type {
  AgentConfigIssueDto,
  StepDto,
  StepErrorDto,
  StepErrorReasonDto,
} from '@shipfox/api-workflows-dto';
import type {OutputDeclarations} from '@shipfox/expression';
import {logger} from '@shipfox/node-opentelemetry';
import {type ExecutionHost, localExecutionHost} from '@shipfox/runner-container';
import type {StepResult} from '@shipfox/runner-execution';
import {type CarriedEnv, prependPath} from '@shipfox/runner-execution/carried-env';
import {createIntegrationToolsGatewayFetch, type LeaseTokenSource} from '@shipfox/runner-protocol';
import {z} from 'zod';
import {
  type CustomMcpServers,
  CustomMcpServerUnavailableError,
  startCustomMcpServers,
} from '#core/custom-mcp-servers.js';
import {
  AgentConfigError,
  AgentHarnessUnavailableError,
  AgentInvocationError,
  AgentPermissionModeError,
  AgentSessionUnavailableError,
} from '#core/errors.js';
import type {
  AgentJobContainer,
  HarnessAdapter,
  HarnessInvocation,
  HarnessToolSurface,
  InferenceCredentialSource,
  RequestedIntegrationTool,
} from '#core/harness.js';
import {
  createIntegrationToolsBridge,
  type IntegrationToolsBridge,
} from '#core/integration-tools-bridge.js';
import {piPackageVersions} from '#core/package-versions.js';
import {piHarnessAdapter} from '#core/pi-adapter.js';
import type {AgentPrerequisiteContract} from '#core/prerequisite-ledger.js';
import {
  DEFAULT_REPOSITORY_CONTEXT_CONFIG,
  logRepositoryContext,
  type RepositoryContextConfig,
  repositoryContextSessionEntry,
  resolveRepositoryContext,
} from '#core/repository-context.js';

const MAX_HARNESS_DIAGNOSTICS = 5;
const MAX_HARNESS_DIAGNOSTIC_MESSAGE_LENGTH = 500;
// Keep stable bridge ports below the OS ephemeral range and above this checkout's
// 20000-24999 worktree-service reservation.
const MCP_BRIDGE_PORT_START = 25_000;
const MCP_BRIDGE_PORT_RANGE = 7_768;

export async function executeAgentStep(
  step: StepDto,
  options: {
    signal?: AbortSignal;
    cwd?: string;
    agentStateDir?: string | undefined;
    session?: Parameters<HarnessAdapter['run']>[0]['session'];
    /** Prompt after runner-owned resume context has been prepended. */
    prompt?: string | undefined;
    runtime: {
      harness: Harness;
      provider: string;
      model: string;
      thinking: string;
      credentials: Record<string, string>;
      custom_provider?: CustomModelProviderRuntimeConfigDto | undefined;
      claude?: ClaudeRuntimeConfigDto | undefined;
    };
    gitConfigGlobal?: string | undefined;
    credentialCaptureId?: string | undefined;
    carriedEnv?: CarriedEnv | undefined;
    /** Where the agent's processes run. Defaults to the runner's own machine. */
    host?: ExecutionHost | undefined;
    /** Set when `host` is the job container. */
    container?: AgentJobContainer | undefined;
    onSessionEntry?: (line: string) => void;
    credentialSource?: InferenceCredentialSource | undefined;
    leaseToken?: LeaseTokenSource | undefined;
    integrationToolsGatewayUrl?: URL | undefined;
    prerequisites?: AgentPrerequisiteContract | undefined;
    /** Env values of custom MCP servers that read secrets, by server name. */
    customMcpServerSecretEnv?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** Header values of custom MCP servers that read secrets, by server name. */
    customMcpServerSecretHeaders?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** Secret forms masked in custom MCP server errors and stderr. */
    redactions?: readonly string[] | undefined;
  },
): Promise<StepResult> {
  if (step.type !== 'agent') {
    return agentFailure(`Unsupported step type: ${step.type}`);
  }

  const configuredPrompt = step.config.prompt;
  const prompt = options.prompt ?? configuredPrompt;
  if (typeof prompt !== 'string' || prompt === '') {
    return agentFailure(
      'Agent step config is missing prompt',
      'agent_config_invalid',
      'step_config_invalid',
    );
  }
  const toolConfig = agentStepConfig(step, options);
  if ('failure' in toolConfig) return toolConfig.failure;
  const {tools, toolSurface, repositoryContext, gateway, requestedGatewayTools} = toolConfig;

  const cwd = options.cwd ?? process.cwd();
  const started = await startStepCustomMcpServers({
    servers: toolConfig.customMcpServers,
    requestedGatewayTools,
    cwd,
    options,
  });
  if ('failure' in started) return started.failure;
  const {customServers} = started;

  const {integrationToolsBridge, requestedIntegrationTools} = stepTools({
    gateway,
    customServers,
    requestedGatewayTools,
    jobExecutionId: step.job_execution_id,
  });

  try {
    return await runSelectedHarness({
      jobExecutionId: step.job_execution_id,
      stepId: step.id,
      attempt: step.current_attempt,
      cwd,
      agentStateDir: options.agentStateDir,
      session: options.session,
      harness: options.runtime.harness,
      model: options.runtime.model,
      outputs: outputDeclarationsFromConfig(step.config.outputs),
      prompt,
      repositoryContext,
      tools,
      mcpServers: integrationToolsBridge === undefined ? undefined : [integrationToolsBridge],
      requestedIntegrationTools,
      credentialSource: options.credentialSource,
      ...(toolSurface === undefined ? {} : {toolSurface}),
      prerequisites: options.prerequisites,
      thinking: options.runtime.thinking,
      provider: options.runtime.provider,
      credentials: options.runtime.credentials,
      customProvider: options.runtime.custom_provider,
      ...(options.runtime.claude === undefined ? {} : {claude: options.runtime.claude}),
      signal: options.signal,
      gitConfigGlobal: options.gitConfigGlobal,
      credentialCaptureId: options.credentialCaptureId,
      carriedEnv: options.carriedEnv,
      placement: agentPlacement(options.host, options.container),
      onSessionEntry: options.onSessionEntry,
    });
  } finally {
    await closeIntegrationToolsBridge(integrationToolsBridge);
    await customServers?.close();
  }
}

function agentStepConfig(
  step: StepDto,
  options: {
    leaseToken?: LeaseTokenSource | undefined;
    integrationToolsGatewayUrl?: URL | undefined;
  },
):
  | {
      tools: readonly string[] | undefined;
      toolSurface: HarnessToolSurface | undefined;
      repositoryContext: RepositoryContextConfig;
      gateway: {url: URL; fetch: typeof fetch} | undefined;
      requestedGatewayTools: readonly RequestedIntegrationTool[] | undefined;
      customMcpServers: readonly MaterializedAgentMcpServerConfigDto[] | undefined;
    }
  | {failure: StepResult} {
  const invalid = (message: string) => ({
    failure: agentFailure(message, 'agent_config_invalid', 'step_config_invalid'),
  });
  const tools = toolsFromConfig(step.config.tools);
  if (tools === 'invalid') return invalid('Agent step config has invalid tools.');
  const mcpServers = mcpServersFromConfig(step.config.mcpServers);
  if (mcpServers === 'invalid') return invalid('Agent step config has invalid integration tools.');
  const customMcpServers = customMcpServersFromConfig(step.config.customMcpServers);
  if (customMcpServers === 'invalid') return invalid('Agent step config has invalid MCP servers.');
  const toolSurface = toolSurfaceFromConfig(step.config.toolSurface);
  if (toolSurface === 'invalid') return invalid('Agent step config has invalid tool surface.');
  const repositoryContext = repositoryContextFromConfig(step.config.repositoryContext);
  if (repositoryContext === 'invalid') {
    return invalid('Agent step config has invalid repository context.');
  }
  const gateway = integrationToolsGateway(mcpServers, options);
  if (gateway === 'invalid') return invalid('Agent step config has invalid integration tools.');
  return {
    tools,
    toolSurface,
    repositoryContext,
    gateway,
    requestedGatewayTools: requestedIntegrationToolsFromConfig(mcpServers),
    customMcpServers,
  };
}

// The gateway and the custom servers share one bridge, so harnesses always see one tool server.
function stepTools(params: {
  gateway: {url: URL; fetch: typeof fetch} | undefined;
  customServers: CustomMcpServers | undefined;
  requestedGatewayTools: readonly RequestedIntegrationTool[] | undefined;
  jobExecutionId: string;
}): {
  integrationToolsBridge: IntegrationToolsBridge | undefined;
  requestedIntegrationTools: readonly RequestedIntegrationTool[] | undefined;
} {
  const {gateway, customServers, requestedGatewayTools} = params;
  if (gateway === undefined && customServers === undefined) {
    return {integrationToolsBridge: undefined, requestedIntegrationTools: requestedGatewayTools};
  }
  return {
    integrationToolsBridge: createIntegrationToolsBridge({
      name: AGENT_TOOLS_MCP_SERVER_ID,
      gateway,
      customServers,
      preferredPort: stableIntegrationToolsBridgePort(
        params.jobExecutionId,
        AGENT_TOOLS_MCP_SERVER_ID,
      ),
    }),
    requestedIntegrationTools: [
      ...(requestedGatewayTools ?? []),
      ...(customServers?.requestedTools ?? []),
    ],
  };
}

async function startStepCustomMcpServers(params: {
  servers: readonly MaterializedAgentMcpServerConfigDto[] | undefined;
  requestedGatewayTools: readonly RequestedIntegrationTool[] | undefined;
  cwd: string;
  options: Parameters<typeof executeAgentStep>[1];
}): Promise<{customServers: CustomMcpServers | undefined} | {failure: StepResult}> {
  const {servers, options} = params;
  if (servers === undefined) return {customServers: undefined};
  try {
    const customServers = await startCustomMcpServers({
      servers,
      secretEnv: options.customMcpServerSecretEnv,
      secretHeaders: options.customMcpServerSecretHeaders,
      host: options.host ?? localExecutionHost,
      cwd: params.cwd,
      baseEnv: customMcpServerBaseEnv(options),
      redactions: options.redactions ?? [],
      reservedToolNames: new Set(
        (params.requestedGatewayTools ?? []).map((tool) =>
          agentIntegrationMcpToolName(tool.connectionSlug, tool.toolId),
        ),
      ),
      signal: options.signal,
    });
    return {customServers};
  } catch (error) {
    if (error instanceof CustomMcpServerUnavailableError) {
      return {failure: agentFailure(error.message, 'agent_mcp_server_unavailable')};
    }
    throw error;
  }
}

// Like the harness's own processes: a container never inherits the runner's environment.
function customMcpServerBaseEnv(options: {
  container?: AgentJobContainer | undefined;
  carriedEnv?: CarriedEnv | undefined;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.container?.env ?? process.env)) {
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, options.carriedEnv?.env);
  if (options.carriedEnv !== undefined && options.carriedEnv.path.length > 0) {
    env.PATH = prependPath(options.carriedEnv.path, env.PATH);
  }
  return env;
}

function agentPlacement(
  host: ExecutionHost | undefined,
  container: AgentJobContainer | undefined,
): Pick<HarnessInvocation, 'host' | 'container'> {
  if (host === undefined) return {};
  return container === undefined ? {host} : {host, container};
}

async function runSelectedHarness(params: {
  jobExecutionId: string;
  stepId: string;
  attempt: number;
  cwd: string;
  agentStateDir: string | undefined;
  session: Parameters<HarnessAdapter['run']>[0]['session'];
  harness: Harness;
  model: string;
  outputs: OutputDeclarations | undefined;
  prompt: string;
  repositoryContext: RepositoryContextConfig;
  tools: readonly string[] | undefined;
  mcpServers: readonly IntegrationToolsBridge[] | undefined;
  requestedIntegrationTools: readonly RequestedIntegrationTool[] | undefined;
  credentialSource: InferenceCredentialSource | undefined;
  toolSurface?: HarnessToolSurface | undefined;
  prerequisites: AgentPrerequisiteContract | undefined;
  thinking: string;
  provider: string;
  credentials: Record<string, string>;
  customProvider: CustomModelProviderRuntimeConfigDto | undefined;
  claude?: ClaudeRuntimeConfigDto | undefined;
  signal: AbortSignal | undefined;
  gitConfigGlobal: string | undefined;
  credentialCaptureId: string | undefined;
  carriedEnv: CarriedEnv | undefined;
  placement: Pick<HarnessInvocation, 'host' | 'container'>;
  onSessionEntry: ((line: string) => void) | undefined;
}): Promise<StepResult> {
  const {
    jobExecutionId,
    stepId,
    attempt,
    cwd,
    agentStateDir,
    session,
    harness,
    model,
    outputs,
    prompt,
    tools,
    mcpServers,
    requestedIntegrationTools,
    credentialSource,
    toolSurface,
    prerequisites,
    thinking,
    provider,
    credentials,
    customProvider,
    claude,
    gitConfigGlobal,
    credentialCaptureId,
    carriedEnv,
    placement,
    onSessionEntry,
  } = params;
  const signal = params.signal ?? new AbortController().signal;

  try {
    const repositoryContext = await resolveRepositoryContext({
      cwd,
      harness,
      config: params.repositoryContext,
    });
    logRepositoryContext({context: repositoryContext, harness, stepId, attempt});
    forwardSessionEntry(onSessionEntry, repositoryContextSessionEntry(repositoryContext));
    const adapter = await selectHarnessAdapter(harness);
    const harnessResult = await raceAbort(
      adapter.run({
        jobExecutionId,
        stepId,
        attempt,
        cwd,
        ...(agentStateDir === undefined ? {} : {agentStateDir}),
        ...(session === undefined ? {} : {session}),
        model,
        provider,
        thinking,
        prompt,
        repositoryContext,
        ...(tools === undefined ? {} : {tools}),
        ...(mcpServers === undefined ? {} : {mcpServers}),
        ...(requestedIntegrationTools === undefined ? {} : {requestedIntegrationTools}),
        ...(credentialSource === undefined ? {} : {credentialSource}),
        ...(toolSurface === undefined ? {} : {toolSurface}),
        ...(prerequisites === undefined ? {} : {prerequisites}),
        outputs,
        credentials,
        customProvider,
        ...(claude === undefined ? {} : {claude}),
        signal,
        ...(gitConfigGlobal ? {gitConfigGlobal} : {}),
        ...(credentialCaptureId ? {credentialCaptureId} : {}),
        ...(carriedEnv ? {carriedEnv} : {}),
        ...placement,
        ...(onSessionEntry ? {onSessionEntry} : {}),
      }),
      signal,
    );
    return successfulHarnessResult(harnessResult, session);
  } catch (error) {
    return harnessFailureResult(error, {harness, jobExecutionId, stepId, attempt}, session);
  }
}

function successfulHarnessResult(
  harnessResult: Awaited<ReturnType<HarnessAdapter['run']>>,
  session: Parameters<HarnessAdapter['run']>[0]['session'],
): StepResult {
  return {
    success: true,
    response: harnessResult.response ?? '',
    ...(harnessResult.outputs === undefined ? {} : {outputs: harnessResult.outputs}),
    ...(session?.mode === 'fork' || harnessResult.sessionFile === undefined
      ? {}
      : {sessionFile: harnessResult.sessionFile}),
    ...(session?.mode === 'fork' || harnessResult.sessionId === undefined
      ? {}
      : {sessionId: harnessResult.sessionId}),
    error: null,
    exit_code: 0,
  };
}

function harnessFailureResult(
  error: unknown,
  context: {harness: Harness; jobExecutionId: string; stepId: string; attempt: number},
  session: Parameters<HarnessAdapter['run']>[0]['session'],
): StepResult {
  if (error instanceof AgentHarnessUnavailableError) {
    logHarnessUnavailable({error, ...context});
  }
  if (error instanceof AgentPermissionModeError) {
    logPermissionModeDowngraded({error, ...context});
  }
  let reason: StepErrorReasonDto = 'agent_invocation_failed';
  if (error instanceof AgentHarnessUnavailableError) reason = 'agent_harness_unavailable';
  else if (error instanceof AgentSessionUnavailableError) reason = 'agent_session_unavailable';
  else if (error instanceof AgentConfigError) reason = 'agent_config_invalid';
  const invocationError = error instanceof AgentInvocationError ? error : undefined;
  const failure = agentFailure(
    error instanceof Error ? error.message : String(error),
    reason,
    error instanceof AgentConfigError ? error.agentConfigIssue : undefined,
    invocationError?.response,
    invocationError?.code ?? invocationError?.failurePhase,
    invocationError?.retryable,
    invocationError?.attemptCount,
    invocationError?.maxAttempts,
  );
  if (
    error instanceof AgentInvocationError &&
    session?.mode !== 'fork' &&
    error.sessionFile !== undefined
  ) {
    failure.sessionFile = error.sessionFile;
    if (error.sessionId !== undefined) failure.sessionId = error.sessionId;
  }
  return failure;
}

function logPermissionModeDowngraded(params: {
  error: AgentPermissionModeError;
  harness: Harness;
  jobExecutionId: string;
  stepId: string;
  attempt: number;
}): void {
  const {error, harness, jobExecutionId, stepId, attempt} = params;
  logger().error(
    {
      event: 'runner.agent_permission_mode_downgraded',
      harness,
      jobExecutionId,
      stepId,
      attempt,
      requestedPermissionMode: error.requested,
      observedPermissionMode: error.observed,
    },
    'Agent permission mode downgraded',
  );
}

function logHarnessUnavailable(params: {
  error: AgentHarnessUnavailableError;
  harness: Harness;
  jobExecutionId: string;
  stepId: string;
  attempt: number;
}): void {
  const {error, harness, jobExecutionId, stepId, attempt} = params;
  const {environment} = error;
  logger().error(
    {
      event: 'runner.agent_harness_unavailable',
      harness,
      jobExecutionId,
      stepId,
      attempt,
      cwd: environment.cwd,
      provider: environment.provider,
      model: environment.model,
      thinking: environment.thinking,
      requestedExtensionPaths: environment.extensionPaths,
      ...(environment.resolvedExtensionPaths === undefined
        ? {}
        : {resolvedExtensionPaths: environment.resolvedExtensionPaths}),
      diagnostics: error.diagnostics.slice(0, MAX_HARNESS_DIAGNOSTICS).map((diagnostic) => ({
        type: diagnostic.type,
        message: diagnostic.message.slice(0, MAX_HARNESS_DIAGNOSTIC_MESSAGE_LENGTH),
      })),
      resourceLoaderErrors: error.resourceLoaderErrors
        .slice(0, MAX_HARNESS_DIAGNOSTICS)
        .map((resourceError) => ({
          path: resourceError.path,
          error: resourceError.error.slice(0, MAX_HARNESS_DIAGNOSTIC_MESSAGE_LENGTH),
        })),
      packageVersions: piPackageVersions(),
      ...(process.env.RUNNER_VERSION ? {runnerVersion: process.env.RUNNER_VERSION} : {}),
      ...(process.env.IMAGE_REVISION ? {imageRevision: process.env.IMAGE_REVISION} : {}),
      ...(process.env.IMAGE_CREATED ? {imageCreated: process.env.IMAGE_CREATED} : {}),
      ...(process.env.BUILD_NUMBER ? {buildNumber: process.env.BUILD_NUMBER} : {}),
    },
    'Agent harness unavailable',
  );
}

async function selectHarnessAdapter(harness: Harness): Promise<HarnessAdapter> {
  switch (harness) {
    case 'pi':
      return piHarnessAdapter;
    case 'claude':
      return (await import('#core/claude-adapter.js')).claudeHarnessAdapter;
  }
}

// pi has no built-in timeout and may not reject session.prompt() the instant we
// abort. Racing the adapter run call against the abort signal guarantees the step
// loop reaches its abort-before-report guard in seconds instead of hanging until
// lease expiry; the pi adapter still calls session.abort() to stop the agent's own work.
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // `work` (the adapter run call) is already in flight; attach a no-op catch so its
    // eventual rejection can't surface as an unhandled rejection on the aborted path.
    void work.catch(() => undefined);
    return Promise.reject(abortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, {once: true});
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function abortError(): Error {
  const error = new Error('Agent step aborted');
  error.name = 'AbortError';
  return error;
}

// Agent-step failures split into a user-fixable config error (`agent_config_invalid`)
// and a genuine provider/API failure (`agent_invocation_failed`, the default); the
// server derives the `user` category from the step type for both. An aborted step never
// reaches the API: the step loop returns before reporting once the signal fires.
function agentFailure(
  message: string,
  reason: StepErrorReasonDto = 'agent_invocation_failed',
  agentConfigIssue?: AgentConfigIssueDto,
  response?: string,
  code?: string,
  retryable?: boolean,
  attemptCount?: number,
  maxAttempts?: number,
): StepResult {
  const error: StepErrorDto = {
    message,
    reason,
    ...(agentConfigIssue === undefined ? {} : {agent_config_issue: agentConfigIssue}),
    ...(code === undefined ? {} : {code}),
    ...(retryable === undefined ? {} : {retryable}),
    ...(attemptCount === undefined ? {} : {attempt_count: attemptCount}),
    ...(maxAttempts === undefined ? {} : {max_attempts: maxAttempts}),
  };
  return {
    success: false,
    ...(response === undefined ? {} : {response}),
    error,
    exit_code: null,
  };
}

function requestedIntegrationToolsFromConfig(
  mcpServers: readonly AgentIntegrationMcpServerConfigDto[] | undefined,
): readonly RequestedIntegrationTool[] | undefined {
  if (mcpServers === undefined) return undefined;
  return mcpServers.flatMap((server) =>
    server.integrations.flatMap((integration) =>
      integration.tools.map((tool) => ({
        connectionSlug: integration.connectionSlug,
        toolId: tool.id,
      })),
    ),
  );
}

function repositoryContextFromConfig(value: unknown): RepositoryContextConfig | 'invalid' {
  if (value === undefined) return DEFAULT_REPOSITORY_CONTEXT_CONFIG;
  const parsed = agentRepositoryContextConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : 'invalid';
}

function forwardSessionEntry(
  onSessionEntry: ((line: string) => void) | undefined,
  line: string,
): void {
  if (onSessionEntry === undefined) return;
  try {
    onSessionEntry(line);
  } catch {
    // Session forwarding is best-effort and must not affect the agent step.
  }
}

function toolSurfaceFromConfig(value: unknown): HarnessToolSurface | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === 'strict-direct' || value === 'discovery') return value;
  return 'invalid';
}

function outputDeclarationsFromConfig(value: unknown): OutputDeclarations | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as OutputDeclarations;
}

function toolsFromConfig(value: unknown): readonly string[] | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) return 'invalid';
  if (value.some((tool) => typeof tool !== 'string' || tool === '')) return 'invalid';
  return [...value];
}

function mcpServersFromConfig(
  value: unknown,
): readonly AgentIntegrationMcpServerConfigDto[] | undefined | 'invalid' {
  if (value === undefined) return undefined;
  const parsed = z.array(agentIntegrationMcpServerSchema).length(1).safeParse(value);
  return parsed.success ? parsed.data : 'invalid';
}

function customMcpServersFromConfig(
  value: unknown,
): readonly MaterializedAgentMcpServerConfigDto[] | undefined | 'invalid' {
  if (value === undefined) return undefined;
  const parsed = z.array(materializedAgentMcpServerSchema).min(1).safeParse(value);
  return parsed.success ? parsed.data : 'invalid';
}

function integrationToolsGateway(
  mcpServers: readonly AgentIntegrationMcpServerConfigDto[] | undefined,
  options: {
    leaseToken?: LeaseTokenSource | undefined;
    integrationToolsGatewayUrl?: URL | undefined;
  },
): {url: URL; fetch: typeof fetch} | undefined | 'invalid' {
  const {leaseToken, integrationToolsGatewayUrl} = options;
  if (mcpServers === undefined) return undefined;
  if (leaseToken === undefined || integrationToolsGatewayUrl === undefined) return 'invalid';
  return {
    url: integrationToolsGatewayUrl,
    fetch: createIntegrationToolsGatewayFetch(leaseToken, integrationToolsGatewayUrl),
  };
}

function stableIntegrationToolsBridgePort(seed: string, serverName: string): number {
  // pi-mcp-adapter includes the server URL in its metadata-cache hash. Keep the
  // loopback port stable within a job so cached direct tools remain valid across steps.
  const digest = createHash('sha256').update(`${seed}:${serverName}`).digest();
  return MCP_BRIDGE_PORT_START + (digest.readUInt16BE(0) % MCP_BRIDGE_PORT_RANGE);
}

async function closeIntegrationToolsBridge(
  bridge: IntegrationToolsBridge | undefined,
): Promise<void> {
  try {
    await bridge?.close();
  } catch (error) {
    logger().warn({err: error}, 'Failed to close integration tools bridge');
  }
}
