import {join} from 'node:path';
import {
  type ApiKeyCredential,
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSessionFromServices,
  createAgentSessionServices,
  defineTool,
  ModelRegistry,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import {
  type CustomAgentModelDto,
  type CustomModelProviderRuntimeConfigDto,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_INPUT_IMAGE,
  DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_MODEL_REASONING,
} from '@shipfox/api-agent-dto';
import {Type} from 'typebox';
import {assertRunnerEgressAllowed} from '#core/egress.js';
import {AgentConfigError, AgentInvocationError} from '#core/errors.js';
import type {HarnessAdapter, HarnessInvocation, HarnessResult} from '#core/harness.js';
import {
  OutputCollector,
  RequiredOutputsMissingError,
  runOutputTurnLoop,
  withOutputGuidance,
} from '#core/output-collector.js';
import {type SessionForwarder, startSessionForwarder} from '#core/session-forwarder.js';

const KEYLESS_CUSTOM_PROVIDER_API_KEY = 'shipfox-keyless-custom-provider-placeholder';
const SECRET_HEADER_CREDENTIAL_PREFIX = 'header:';

type PiThinkingLevel = NonNullable<CreateAgentSessionOptions['thinkingLevel']>;
type ModelRegistryInstance = ReturnType<typeof ModelRegistry.create>;
type CustomProviderConfig = Parameters<ModelRegistryInstance['registerProvider']>[1];
type CustomProviderModel = NonNullable<CustomProviderConfig['models']>[number];

export const piHarnessAdapter: HarnessAdapter = {run: runPiAgent};

/**
 * Runs the pi coding agent for one step. Resolves when the agent's turn completes and
 * throws on a pi/provider failure or abort, so the caller maps a resolved call to a
 * succeeded step and a thrown call to a failed step.
 *
 * The returned `response` is the agent's final assistant message, capped and reported
 * separately from structured outputs.
 */
async function runPiAgent(invocation: HarnessInvocation): Promise<HarnessResult> {
  const {
    cwd,
    model: modelId,
    provider,
    thinking,
    prompt,
    tools,
    credentials,
    customProvider,
    gitConfigGlobal,
    signal,
    onSessionEntry,
  } = invocation;
  const collector = new OutputCollector(invocation.outputs);
  const hasDeclaredOutputs =
    invocation.outputs !== undefined && Object.keys(invocation.outputs).length > 0;

  // A listener added to an already-aborted signal never fires, so an abort that lands
  // before this point (or during the awaits below) would leave pi running and burning
  // tokens after the step loop has moved on. Guard on entry, then again once the
  // session exists so a mid-creation abort still stops pi.
  if (signal.aborted) throw new Error('Agent step aborted before the pi session started');

  const authStorage =
    customProvider === undefined
      ? AuthStorage.inMemory({
          [provider]: toPiRuntimeCredential(provider, credentials),
        })
      : AuthStorage.inMemory({});
  const modelRegistry = ModelRegistry.create(authStorage);
  if (customProvider !== undefined) {
    await registerCustomProvider(modelRegistry, provider, credentials, customProvider);
  }
  const model = resolveModel(modelRegistry, provider, modelId);

  // Surface a missing key up front as a config error: otherwise it fails deep inside the
  // provider call as an opaque invocation failure, hiding that the fix is workspace config.
  if (!modelRegistry.hasConfiguredAuth(model)) {
    throw new AgentConfigError(
      `No credentials configured for provider "${provider}". ` +
        'Verify the provider is configured for this workspace.',
      'provider_not_configured',
    );
  }

  const services = await createAgentSessionServices({
    cwd,
    authStorage,
    modelRegistry,
    resourceLoaderOptions: {
      additionalExtensionPaths: ['pi-web-access'],
    },
  });

  const {session} = await createAgentSessionFromServices({
    services,
    model,
    thinkingLevel: thinking as PiThinkingLevel,
    ...piToolsOption(tools, customProvider),
    ...(hasDeclaredOutputs ? {customTools: [setOutputTool(collector)]} : {}),
    // Keep the session JSONL inside the job workspace so it forwards from a deterministic path
    // and is cleaned up with the workspace; pi's default lives under ~/.pi, outside it.
    sessionManager: SessionManager.create(cwd, join(cwd, 'logs', 'agent-sessions')),
  });

  // session.abort() returns a promise; a rejected abort must not become an unhandled
  // rejection that crashes the long-lived runner, so swallow it.
  const abortSession = () => {
    Promise.resolve(session.abort()).catch(() => undefined);
  };

  if (signal.aborted) {
    abortSession();
    throw new Error('Agent step aborted during pi session creation');
  }

  signal.addEventListener('abort', abortSession, {once: true});
  const forwarder = startForwarding(session.sessionFile, onSessionEntry);
  // pi may not settle session.prompt() promptly on abort (step.ts races the call), so the
  // finally below can be delayed indefinitely. Stop the forwarder on abort too, or its poll
  // timer leaks past workspace teardown. stop() is idempotent, so the finally re-calling it is
  // safe, and the early stop still does its final drain.
  const stopForwarder = () => forwarder?.stop();
  signal.addEventListener('abort', stopForwarder, {once: true});
  const restoreGitConfigGlobal = createGitConfigGlobalRestorer(gitConfigGlobal);
  if (gitConfigGlobal) {
    // The runner executes one agent step at a time in this process; restore promptly so the
    // process-global Git config cannot leak into the next step.
    process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal;
    signal.addEventListener('abort', restoreGitConfigGlobal, {once: true});
  }
  try {
    let response = '';
    await runOutputTurnLoop({
      signal,
      prompt: hasDeclaredOutputs ? withOutputGuidance(prompt, collector.guidanceText()) : prompt,
      runTurn: async (message) => {
        await session.prompt(message);
        const assistantError = lastAssistantError(session.messages);
        if (assistantError !== undefined) {
          throw new AgentInvocationError(assistantError, session.getLastAssistantText() ?? '');
        }
        response = session.getLastAssistantText() ?? '';
      },
      missingRequired: () => collector.missingRequired(),
    });
    const outputs = collector.snapshot();
    return {
      response,
      ...(Object.keys(outputs).length === 0 ? {} : {outputs}),
    };
  } catch (error) {
    if (error instanceof RequiredOutputsMissingError) {
      throw new AgentInvocationError(error.message, session.getLastAssistantText() ?? '');
    }
    throw error;
  } finally {
    // A final synchronous read forwards every entry written before the caller closes the log
    // stream, so all session records precede its end marker.
    forwarder?.stop();
    restoreGitConfigGlobal();
    signal.removeEventListener('abort', abortSession);
    signal.removeEventListener('abort', stopForwarder);
    signal.removeEventListener('abort', restoreGitConfigGlobal);
  }
}

function piToolsOption(
  tools: readonly string[] | undefined,
  customProvider: CustomModelProviderRuntimeConfigDto | undefined,
): {tools: string[]} | {noTools: 'builtin'} | Record<string, never> {
  if (tools !== undefined) return {tools: [...tools]};
  return customProvider === undefined ? {} : {noTools: 'builtin'};
}

function lastAssistantError(messages: readonly unknown[]): string | undefined {
  const message = [...messages].reverse().find(isAssistantMessage);
  if (message === undefined || message.stopReason !== 'error') return undefined;
  return message.errorMessage ?? 'Agent provider returned an error.';
}

function isAssistantMessage(message: unknown): message is {
  readonly role: 'assistant';
  readonly stopReason?: string;
  readonly errorMessage?: string;
} {
  return (
    typeof message === 'object' &&
    message !== null &&
    'role' in message &&
    message.role === 'assistant'
  );
}

function setOutputTool(collector: OutputCollector) {
  return defineTool({
    name: 'set_output',
    label: 'Set output',
    description: 'Set one structured output value for this workflow step.',
    promptSnippet: 'set_output records a workflow step output.',
    promptGuidelines: [
      'Use set_output once for each required workflow output before your final response.',
      'Pass all values as strings. For json outputs, pass valid JSON text.',
    ],
    parameters: Type.Object({
      key: Type.String(),
      value: Type.String(),
    }),
    async execute(_toolCallId, params) {
      await Promise.resolve();
      const result = collector.trySet(params.key, params.value);
      return {
        content: [
          {
            type: 'text',
            text: result.ok ? `Output "${params.key}" set.` : result.feedback,
          },
        ],
        details: result,
      };
    },
  });
}

async function registerCustomProvider(
  modelRegistry: ModelRegistryInstance,
  provider: string,
  credentials: Record<string, string>,
  customProvider: CustomModelProviderRuntimeConfigDto,
): Promise<void> {
  // Redirects and DNS changes after this point remain transport-layer SSRF
  // residuals until pi exposes per-request IP pinning hooks.
  await assertRunnerEgressAllowed(customProvider.base_url, 'Custom model provider endpoint');

  const apiKey = customProviderApiKey(provider, customProvider, credentials);

  try {
    modelRegistry.registerProvider(provider, {
      name: provider,
      baseUrl: customProvider.base_url,
      api: customProvider.api,
      apiKey,
      headers: customProviderHeaders(customProvider, credentials),
      models: customProvider.models.map((model) => toPiCustomProviderModel(customProvider, model)),
    });
  } catch (error) {
    throw new AgentConfigError(
      error instanceof Error && error.message.length > 0
        ? `Custom model provider "${provider}" is invalid: ${error.message}`
        : `Custom model provider "${provider}" is invalid.`,
    );
  }
}

function customProviderApiKey(
  provider: string,
  customProvider: CustomModelProviderRuntimeConfigDto,
  credentials: Record<string, string>,
): string {
  const apiKey = credentials.api_key;
  if (!customProvider.requires_api_key) return KEYLESS_CUSTOM_PROVIDER_API_KEY;
  if (apiKey !== undefined && apiKey !== '') return apiKey;

  throw new AgentConfigError(
    `Custom model provider "${provider}" requires an API key but none was resolved.`,
    'credentials_invalid',
  );
}

function customProviderHeaders(
  customProvider: CustomModelProviderRuntimeConfigDto,
  credentials: Record<string, string>,
): Record<string, string> {
  const headers = Object.fromEntries(
    customProvider.headers.map((header) => [header.name, header.value]),
  );

  for (const name of customProvider.secret_header_names) {
    const value = credentials[`${SECRET_HEADER_CREDENTIAL_PREFIX}${name}`];
    if (value === undefined || value === '') continue;
    headers[name] = value;
  }

  return headers;
}

function toPiCustomProviderModel(
  customProvider: CustomModelProviderRuntimeConfigDto,
  model: CustomAgentModelDto,
): CustomProviderModel {
  const inputImage = model.input_image ?? DEFAULT_CUSTOM_MODEL_INPUT_IMAGE;
  const piModel: CustomProviderModel = {
    id: model.id,
    name: model.label,
    api: customProvider.api,
    reasoning: model.reasoning ?? DEFAULT_CUSTOM_MODEL_REASONING,
    input: inputImage ? ['text', 'image'] : ['text'],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    contextWindow: model.context_window ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens: model.max_output_tokens ?? DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  };
  return piModel;
}

function createGitConfigGlobalRestorer(gitConfigGlobal: string | undefined): () => void {
  let restored = false;
  const previous = process.env.GIT_CONFIG_GLOBAL;
  return () => {
    if (gitConfigGlobal === undefined || restored) return;
    restored = true;
    if (previous === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
      return;
    }
    process.env.GIT_CONFIG_GLOBAL = previous;
  };
}

function startForwarding(
  sessionFile: string | undefined,
  onSessionEntry: ((line: string) => void) | undefined,
): SessionForwarder | undefined {
  if (onSessionEntry === undefined || sessionFile === undefined) return undefined;
  return startSessionForwarder({filePath: sessionFile, onEntry: onSessionEntry});
}

type ResolvedModel = NonNullable<ReturnType<ModelRegistry['find']>>;

// pi's `find` returns undefined for both an unknown provider and a known provider that
// lacks the model, so split them on the registry's provider set to give an actionable
// message (and, when another provider carries the same id, a did-you-mean hint).
function resolveModel(
  modelRegistry: ModelRegistry,
  provider: string,
  modelId: string,
): ResolvedModel {
  const model = modelRegistry.find(provider, modelId);
  if (model) return model;

  const all = modelRegistry.getAll();
  const knownProviders = new Set(all.map((entry) => entry.provider));
  if (!knownProviders.has(provider)) {
    throw new AgentConfigError(
      `Unknown provider "${provider}" for agent step. ` +
        'Known providers are pi built-ins plus any from models.json.',
      'provider_unsupported',
    );
  }

  const alternativeProvider = all.find((entry) => entry.id === modelId)?.provider;
  const hint =
    alternativeProvider === undefined
      ? ''
      : ` Did you mean to set provider: ${alternativeProvider}?`;
  throw new AgentConfigError(
    `Model "${modelId}" is not available for provider "${provider}".${hint}`,
    'model_unavailable',
  );
}

function toPiRuntimeCredential(
  provider: string,
  credentials: Record<string, string>,
): ApiKeyCredential {
  const credential: ApiKeyCredential = {
    type: 'api_key',
    key: credentialValue(provider, credentials, 'api_key'),
  };
  const env = providerCredentialEnv(provider, credentials);
  return env === undefined ? credential : {...credential, env};
}

function providerCredentialEnv(
  provider: string,
  credentials: Record<string, string>,
): Record<string, string> | undefined {
  switch (provider) {
    case 'azure-openai-responses':
      return {AZURE_OPENAI_BASE_URL: credentialValue(provider, credentials, 'endpoint')};
    case 'cloudflare-ai-gateway':
      return {
        CLOUDFLARE_ACCOUNT_ID: credentialValue(provider, credentials, 'account_id'),
        CLOUDFLARE_GATEWAY_ID: credentialValue(provider, credentials, 'gateway_id'),
      };
    case 'cloudflare-workers-ai':
      return {CLOUDFLARE_ACCOUNT_ID: credentialValue(provider, credentials, 'account_id')};
    default:
      return undefined;
  }
}

function credentialValue(
  provider: string,
  credentials: Record<string, string>,
  key: string,
): string {
  const value = credentials[key];
  if (value === undefined || value === '') {
    throw new AgentConfigError(
      `Runtime credentials for provider "${provider}" are missing "${key}".`,
      'credentials_invalid',
    );
  }
  return value;
}
