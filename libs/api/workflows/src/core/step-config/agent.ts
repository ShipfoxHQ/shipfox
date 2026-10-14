import {
  AGENT_INTEGRATION_MCP_AUTH,
  AGENT_INTEGRATION_MCP_ENDPOINT,
  AGENT_INTEGRATION_MCP_SERVER_NAME,
  AGENT_INTEGRATION_MCP_TRANSPORT,
  type AgentIntegrationMcpServerConfigDto,
  type AgentRepositoryContextConfigDto,
  type MaterializedAgentIntegrationConfigDto,
  type MaterializedAgentMcpServerConfigDto,
  materializedAgentMcpServerSchema,
  sanitizeAgentIntegrationConnectionSlug,
} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {MaterializedSecretBindingDto} from '@shipfox/api-secrets-dto';
import {
  type AgentStepSessionIntentDto,
  agentStepSessionDescriptorSchema,
  agentStepSessionIntentSchema,
} from '@shipfox/api-workflows-dto';
import type {ResolvedField, SiteResolvedField} from '@shipfox/expression';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import type {AgentThinking} from '@shipfox/workflow-document';
import type {AgentDefaultsResolver, ResolvedAgentDefaults} from '#core/agent-defaults.js';
import {
  type AgentToolMaterializationContext,
  type AgentToolMaterializationSnapshot,
  materializeAgentIntegrations,
} from '#core/agent-tools.js';
import type {PersistedEvaluationTraceEntry, StepConfigDispatchPlan} from '#core/entities/step.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  InterpolationUnresolvableError,
} from '#core/errors.js';
import {
  completeStepFieldWithTrace,
  literalField,
  resolveStepField,
  type WorkflowStepEvaluationTraceEntry,
  type WorkflowStepTemplateDiagnostic,
} from './fields.js';
import {completeDispatchField} from './run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelAgentStep = Extract<WorkflowModelStep, {kind: 'agent'}>;
type StepConfigMode = 'effective' | 'authored';
type FieldResolution =
  | {readonly kind: 'frozen'; readonly value: string}
  | {readonly kind: 'residual'; readonly field: ResolvedField};
type AgentFieldName =
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'agent.thinking'
  | 'agent.session'
  | 'agent.repository_context';
type RepositoryContextToggleResolution =
  | {readonly kind: 'literal'; readonly value: boolean}
  | {readonly kind: 'template'; readonly source: string; readonly field: FieldResolution};
interface RepositoryContextResolution {
  readonly instructions: RepositoryContextToggleResolution;
  readonly skills: RepositoryContextToggleResolution | readonly string[];
}
type RepositoryContextDispatchPlan = NonNullable<
  NonNullable<StepConfigDispatchPlan['agent']>['repositoryContext']
>;
type CustomMcpServerEnvPlan = NonNullable<
  NonNullable<StepConfigDispatchPlan['agent']>['customMcpServerEnv']
>;

interface CustomMcpServerResolution {
  readonly servers: readonly MaterializedAgentMcpServerConfigDto[];
  readonly envPlan: CustomMcpServerEnvPlan | undefined;
}

interface AgentFieldResolutions {
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly trace: WorkflowStepEvaluationTraceEntry[];
  readonly prompt: FieldResolution;
  readonly model: FieldResolution | undefined;
  readonly provider: FieldResolution | undefined;
  readonly thinking: FieldResolution | undefined;
  readonly session: {readonly key: FieldResolution; readonly mode: 'resume' | 'fork'} | undefined;
  readonly repositoryContext: RepositoryContextResolution | undefined;
  readonly customMcpServers: CustomMcpServerResolution | undefined;
  readonly hasTemplates: boolean;
}

export interface ResolveAgentStepConfigParams {
  readonly jobKey: string;
  readonly step: WorkflowModelAgentStep;
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly definitionId: string;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

export interface AgentStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

export async function resolveAgentStepConfig(
  params: ResolveAgentStepConfigParams,
): Promise<AgentStepConfig> {
  const fields = resolveAgentFields(params);
  const usesAuthoredMode = params.mode === 'authored';

  if (usesAuthoredMode) return authoredAgentStepConfig(params.step, fields);

  const hasDeferredAgentField =
    fields.model?.kind === 'residual' ||
    fields.provider?.kind === 'residual' ||
    fields.thinking?.kind === 'residual' ||
    fields.session?.key.kind === 'residual' ||
    repositoryContextIsDeferred(fields.repositoryContext);
  if (hasDeferredAgentField) return deferredAgentStepConfig(params, fields);

  return await agentStepConfigWithDefaults(params.step, params, fields);
}

export async function completeAgentConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): Promise<AgentStepSessionIntentDto | undefined> {
  const agent = params.plan.agent;
  if (agent === undefined) return undefined;

  const prompt =
    agent.prompt === undefined
      ? readConfigString(params.config, 'prompt')
      : completeAgentField({
          field: 'agent.prompt',
          template: agent.prompt,
          params,
        });
  const model =
    agent.model === undefined
      ? readConfigString(params.config, 'model')
      : completeAgentField({
          field: 'agent.model',
          template: agent.model,
          params,
        });
  const provider =
    agent.provider === undefined
      ? readConfigString(params.config, 'provider')
      : completeAgentField({
          field: 'agent.provider',
          template: agent.provider,
          params,
        });
  const thinking =
    agent.thinking === undefined
      ? readConfigThinking(params.config)
      : completeAgentField({field: 'agent.thinking', template: agent.thinking, params});
  const harness = agent.harness ?? readConfigHarness(params.config);
  await applyAgentDefaultsForDispatch({
    agent,
    config: params.config,
    harness,
    provider,
    model,
    thinking,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
  });
  params.config.prompt = prompt;
  let sessionIntent: AgentStepSessionIntentDto | undefined;
  if (agent.session !== undefined) {
    sessionIntent = {
      key: completeAgentField({
        field: 'agent.session',
        template: agent.session.key,
        params,
      }),
      mode: agent.session.mode,
    } satisfies AgentStepSessionIntentDto;
    params.config.session = sessionIntent;
  }
  if (agent.repositoryContext !== undefined) {
    params.config.repositoryContext = completeRepositoryContext(agent.repositoryContext, params);
  }
  if (agent.tools !== undefined) params.config.tools = [...agent.tools];
  if (agent.toolSurface !== undefined) params.config.toolSurface = agent.toolSurface;
  const integrations = agent.integrations === undefined ? undefined : [...agent.integrations];
  if (integrations !== undefined) params.config.integrations = integrations;
  const mcpServers =
    agent.mcpServers ??
    (integrations === undefined ? undefined : agentIntegrationMcpServers(integrations));
  if (mcpServers !== undefined) params.config.mcpServers = [...mcpServers];
  completeCustomMcpServers({...params, agent});
  return sessionIntent;
}

/** Fills the env values that dispatch can know; values that read secrets become bindings. */
function completeCustomMcpServers(params: {
  readonly config: Record<string, unknown>;
  readonly agent: NonNullable<StepConfigDispatchPlan['agent']>;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  if (params.agent.customMcpServers !== undefined) {
    params.config.customMcpServers = params.agent.customMcpServers.map(copyCustomMcpServer);
  }
  const envPlan = params.agent.customMcpServerEnv;
  if (envPlan === undefined) return;
  const servers = materializedAgentMcpServerSchema
    .array()
    .parse(params.config.customMcpServers)
    .map(copyCustomMcpServer);
  const bindings: MaterializedSecretBindingDto[] = [];
  for (const server of servers) {
    for (const [name, template] of Object.entries(envPlan[server.name] ?? {})) {
      const completed = completeDispatchField({
        field: 'agent.mcp_servers.env.value',
        traceField: 'agent.mcp_servers.env.value',
        errorField: 'agent.mcp_servers.env.value',
        template,
        context: params.context,
        definitionId: params.definitionId,
        target: {kind: 'mcp_server_env', server: server.name, name},
        trace: params.trace,
      });
      if (completed.kind === 'binding') bindings.push(completed.binding);
      else server.env[name] = completed.value;
    }
  }
  params.config.customMcpServers = servers;
  if (bindings.length === 0) return;
  const existing = Array.isArray(params.config.secret_bindings)
    ? params.config.secret_bindings
    : [];
  params.config.secret_bindings = [...existing, ...bindings];
}

function copyCustomMcpServer(
  server: MaterializedAgentMcpServerConfigDto,
): MaterializedAgentMcpServerConfigDto {
  return {
    ...server,
    args: [...server.args],
    env: {...server.env},
    ...(server.include === undefined ? {} : {include: [...server.include]}),
  };
}

async function applyAgentDefaultsForDispatch(params: {
  readonly agent: NonNullable<StepConfigDispatchPlan['agent']>;
  readonly config: Record<string, unknown>;
  readonly harness: WorkflowModelAgentStep['harness'] | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly thinking: string | undefined;
  readonly resolveAgentDefaults: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
}): Promise<void> {
  const hasDefaultsPlan =
    params.agent.harness !== undefined ||
    params.agent.provider !== undefined ||
    params.agent.model !== undefined ||
    params.agent.thinking !== undefined;
  const hasMaterializedDefaults =
    params.harness !== undefined &&
    params.provider !== undefined &&
    params.model !== undefined &&
    params.thinking !== undefined;
  if (!hasDefaultsPlan && hasMaterializedDefaults) return;

  const defaults = await completeAgentDefaults({
    harness: params.harness,
    provider: params.provider,
    model: params.model,
    thinking: params.thinking,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
  });
  params.config.harness = defaults.harness;
  params.config.provider = defaults.provider;
  params.config.model = defaults.model;
  params.config.thinking = defaults.thinking;
}

/**
 * Decodes the intent retained in a running step after the dispatch transaction
 * has committed. The shared schema is the single source of truth for this
 * recovery boundary; normal dispatches receive the typed value directly from
 * completeAgentConfig instead.
 */
export function readAgentStepSessionIntent(
  config: Record<string, unknown>,
): AgentStepSessionIntentDto | undefined {
  const parsed = agentStepSessionIntentSchema.safeParse(config.session);
  return parsed.success ? parsed.data : undefined;
}

/** Restore the materialized session intent before redispatch replaces it with a new claim. */
export function restoreAgentSessionIntentForRedispatch(params: {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly authoredConfig: Record<string, unknown> | null;
}): Record<string, unknown> {
  const config = {...params.config};

  // New materializations preserve the resolved intent in the plan. Removing
  // the prior descriptor lets normal dispatch completion restore that value.
  if (params.configPlan?.agent?.session !== undefined) {
    delete config.session;
    return config;
  }

  // Older materializations have no session plan. A descriptor still contains
  // the resolved key, so prefer it over the authored template source.
  const descriptor = agentStepSessionDescriptorSchema.safeParse(config.session);
  if (descriptor.success) {
    config.session = {key: descriptor.data.key, mode: descriptor.data.mode};
    return config;
  }
  if (readAgentStepSessionIntent(config) !== undefined) return config;

  const authored = agentStepSessionIntentSchema.safeParse(params.authoredConfig?.session);
  if (authored.success) config.session = authored.data;
  else delete config.session;
  return config;
}

function completeAgentField(args: {
  readonly field: AgentFieldName;
  readonly template: ResolvedField;
  readonly params: {
    readonly context: WorkflowEvaluationContext;
    readonly definitionId: string;
    readonly trace: PersistedEvaluationTraceEntry[];
  };
}): string {
  const resolved = completeStepFieldWithTrace({
    field: args.field,
    errorField: args.field,
    template: args.template,
    context: args.params.context,
    definitionId: args.params.definitionId,
  });
  args.params.trace.push(...resolved.trace.map((entry) => ({...entry, field: args.field})));
  return resolved.value;
}

export async function completeAgentDefaults(params: {
  readonly harness: WorkflowModelAgentStep['harness'] | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly thinking: string | undefined;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
}): Promise<ResolvedAgentDefaults> {
  if (!params.resolveAgentDefaults) throw new Error('Agent defaults resolver is required');

  try {
    return await params.resolveAgentDefaults({
      harness: params.harness,
      provider: params.provider,
      model: params.model,
      thinking: params.thinking,
    });
  } catch (error) {
    if (
      isInterModuleKnownError(agentInterModuleContract.methods.resolveAgentConfig, error) &&
      error.code === 'agent-config-invalid'
    ) {
      const {details} = error;
      throw new AgentConfigUnresolvableError(params.definitionId, {
        cause: error,
        reason: details.reason,
        model: details.model,
        provider: details.provider,
        ...(details.message === undefined ? {} : {message: details.message}),
        ...(details.managed_provider_id === undefined
          ? {}
          : {
              code: 'workspace-providers-disabled',
              managedProviderId: details.managed_provider_id,
            }),
      });
    }
    throw error;
  }
}

function resolveAgentFields(params: ResolveAgentStepConfigParams): AgentFieldResolutions {
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const trace: WorkflowStepEvaluationTraceEntry[] = [];
  const prompt = resolveAgentField({
    field: 'agent.prompt',
    value: params.step.prompt,
    template: params.step.templates?.prompt,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const model = resolveOptionalAgentField({
    field: 'agent.model',
    value: params.step.model,
    template: params.step.templates?.model,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const provider = resolveOptionalAgentField({
    field: 'agent.provider',
    value: params.step.provider,
    template: params.step.templates?.provider,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const thinking = resolveOptionalAgentField({
    field: 'agent.thinking',
    value: params.step.thinking,
    template: params.step.templates?.thinking,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const session =
    params.step.session === undefined
      ? undefined
      : {
          key: resolveAgentField({
            field: 'agent.session',
            value: sessionKeySource(params.step.session.key),
            template: params.step.session.key,
            context: params.context,
            mode: params.mode,
            diagnostics,
            trace,
            definitionId: params.definitionId,
          }),
          mode: params.step.session.mode,
        };
  const repositoryContext = resolveRepositoryContextFields({
    step: params.step,
    resolveTemplate: (args) =>
      resolveAgentField({
        field: 'agent.repository_context',
        value: args.source,
        template: args.template,
        context: params.context,
        mode: params.mode,
        diagnostics,
        trace,
        definitionId: params.definitionId,
      }),
  });
  const customMcpServers = resolveCustomMcpServers({...params, diagnostics, trace});
  const hasTemplates =
    params.step.harness !== undefined ||
    params.step.templates?.prompt !== undefined ||
    params.step.templates?.model !== undefined ||
    params.step.templates?.provider !== undefined ||
    params.step.templates?.thinking !== undefined ||
    params.step.templates?.repositoryContextInstructions !== undefined ||
    params.step.templates?.repositoryContextSkills !== undefined ||
    params.step.session !== undefined ||
    (params.step.customMcpServers ?? []).some((server) => server.templates?.env !== undefined);

  return {
    diagnostics,
    trace,
    prompt,
    model,
    provider,
    thinking,
    session,
    repositoryContext,
    customMcpServers,
    hasTemplates,
  };
}

function resolveCustomMcpServers(
  params: ResolveAgentStepConfigParams & {
    readonly diagnostics: WorkflowStepTemplateDiagnostic[];
    readonly trace: WorkflowStepEvaluationTraceEntry[];
  },
): CustomMcpServerResolution | undefined {
  const authoredServers = params.step.customMcpServers;
  if (authoredServers === undefined) return undefined;

  const envPlan: Record<string, Record<string, ResolvedField>> = {};
  const servers = authoredServers.map((server): MaterializedAgentMcpServerConfigDto => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(server.env ?? {})) {
      const template = server.templates?.env?.[name];
      if (template === undefined || params.mode === 'authored') {
        env[name] = value;
        continue;
      }
      const resolved = resolveStepField({
        field: 'agent.mcp_servers.env.value',
        template: {segments: template},
        context: params.context,
        definitionId: params.definitionId,
        errorField: 'agent.mcp_servers.env.value',
        envKey: name,
      });
      params.diagnostics.push(
        ...resolved.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          field: 'agent.mcp_servers.env.value' as const,
          envKey: name,
        })),
      );
      params.trace.push(
        ...resolved.trace.map((entry) => ({
          ...entry,
          field: 'agent.mcp_servers.env.value' as const,
          envKey: name,
        })),
      );
      if (resolved.kind === 'residual') {
        envPlan[server.name] = {...envPlan[server.name], [name]: resolved.field};
      } else {
        env[name] = resolved.value;
      }
    }
    return {
      name: server.name,
      command: server.command,
      args: [...server.args],
      env,
      ...(server.include === undefined ? {} : {include: [...server.include]}),
    };
  });
  return {servers, envPlan: Object.keys(envPlan).length === 0 ? undefined : envPlan};
}

function authoredAgentStepConfig(
  step: WorkflowModelAgentStep,
  fields: AgentFieldResolutions,
): AgentStepConfig {
  return {
    config: {
      ...(step.provider === undefined ? {} : {provider: step.provider}),
      ...(step.model === undefined ? {} : {model: step.model}),
      ...(step.harness === undefined ? {} : {harness: step.harness}),
      ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
      ...(step.session === undefined ? {} : {session: authoredSession(step.session)}),
      ...(step.repositoryContext === undefined ? {} : {repositoryContext: step.repositoryContext}),
      ...agentToolsConfig(step),
      ...agentToolSurfaceConfig(step),
      ...authoredAgentIntegrationsConfig(step),
      ...customMcpServersConfig(fields),
      prompt: step.prompt,
    },
    configPlan: null,
    diagnostics: fields.diagnostics,
    trace: fields.trace,
    hasTemplates: fields.hasTemplates,
  };
}

function deferredAgentStepConfig(
  params: ResolveAgentStepConfigParams,
  fields: AgentFieldResolutions,
): AgentStepConfig {
  const {step} = params;
  return {
    config: {},
    configPlan: {
      agent: {
        prompt: dispatchPlanField(fields.prompt),
        ...(fields.model === undefined ? {} : {model: dispatchPlanField(fields.model)}),
        ...(fields.provider === undefined ? {} : {provider: dispatchPlanField(fields.provider)}),
        ...(step.harness === undefined ? {} : {harness: step.harness}),
        ...(fields.thinking === undefined ? {} : {thinking: dispatchPlanField(fields.thinking)}),
        ...(fields.session === undefined
          ? {}
          : {session: {key: dispatchPlanField(fields.session.key), mode: fields.session.mode}}),
        ...(fields.repositoryContext === undefined
          ? {}
          : {
              repositoryContext: repositoryContextDispatchPlan(
                fields.repositoryContext,
                params.definitionId,
              ),
            }),
        ...agentToolsConfig(step),
        ...agentToolSurfaceConfig(step),
        ...materializedAgentIntegrationsConfig(params, fields),
        ...customMcpServersConfig(fields),
        ...customMcpServerEnvPlan(fields),
      },
    },
    diagnostics: fields.diagnostics,
    trace: fields.trace,
    hasTemplates: fields.hasTemplates,
  };
}

async function agentStepConfigWithDefaults(
  step: WorkflowModelAgentStep,
  params: ResolveAgentStepConfigParams,
  fields: AgentFieldResolutions,
): Promise<AgentStepConfig> {
  const providerValue = frozenFieldValue(fields.provider);
  const modelValue = frozenFieldValue(fields.model);
  const promptIsDeferred = fields.prompt.kind === 'residual';

  const resolved = await completeAgentDefaults({
    harness: step.harness,
    provider: providerValue,
    model: modelValue,
    thinking: frozenFieldValue(fields.thinking),
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
  });
  if (promptIsDeferred) {
    return {
      config: {
        provider: resolved.provider,
        model: resolved.model,
        harness: resolved.harness,
        thinking: resolved.thinking,
        ...(fields.session === undefined
          ? {}
          : {session: {key: frozenFieldValue(fields.session.key), mode: fields.session.mode}}),
        ...materializedRepositoryContextConfig(fields.repositoryContext, params.definitionId),
      },
      configPlan: {
        agent: {
          prompt: dispatchPlanField(fields.prompt),
          ...(fields.session === undefined
            ? {}
            : {
                session: {
                  key: dispatchPlanField(fields.session.key),
                  mode: fields.session.mode,
                },
              }),
          ...agentToolsConfig(step),
          ...agentToolSurfaceConfig(step),
          ...materializedAgentIntegrationsConfig(params, fields),
          ...customMcpServersConfig(fields),
          ...customMcpServerEnvPlan(fields),
        },
      },
      diagnostics: fields.diagnostics,
      trace: fields.trace,
      hasTemplates: fields.hasTemplates,
    };
  }

  const promptValue = frozenFieldValue(fields.prompt) ?? step.prompt;
  const agentPlan = {
    ...(fields.session === undefined
      ? {}
      : {
          session: {
            key: dispatchPlanField(fields.session.key),
            mode: fields.session.mode,
          },
        }),
    ...customMcpServerEnvPlan(fields),
  };
  return {
    config: {
      provider: resolved.provider,
      model: resolved.model,
      harness: resolved.harness,
      thinking: resolved.thinking,
      ...(fields.session === undefined
        ? {}
        : {session: {key: frozenFieldValue(fields.session.key), mode: fields.session.mode}}),
      ...materializedRepositoryContextConfig(fields.repositoryContext, params.definitionId),
      ...agentToolsConfig(step),
      ...agentToolSurfaceConfig(step),
      ...materializedAgentIntegrationsConfig(params, fields),
      ...customMcpServersConfig(fields),
      prompt: promptValue,
    },
    configPlan: Object.keys(agentPlan).length === 0 ? null : {agent: agentPlan},
    diagnostics: fields.diagnostics,
    trace: fields.trace,
    hasTemplates: fields.hasTemplates,
  };
}

function agentToolsConfig(
  step: WorkflowModelAgentStep,
): {readonly tools: readonly string[]} | Record<string, never> {
  return step.tools === undefined ? {} : {tools: [...step.tools]};
}

function agentToolSurfaceConfig(
  step: WorkflowModelAgentStep,
):
  | {readonly toolSurface: NonNullable<WorkflowModelAgentStep['toolSurface']>}
  | Record<string, never> {
  return step.toolSurface === undefined ? {} : {toolSurface: step.toolSurface};
}

function authoredAgentIntegrationsConfig(
  step: WorkflowModelAgentStep,
):
  | {readonly integrations: NonNullable<WorkflowModelAgentStep['integrations']>}
  | Record<string, never> {
  return step.integrations === undefined ? {} : {integrations: step.integrations};
}

function materializedAgentIntegrationsConfig(
  params: ResolveAgentStepConfigParams,
  fields: AgentFieldResolutions,
):
  | {
      readonly integrations: readonly MaterializedAgentIntegrationConfigDto[];
      readonly mcpServers: readonly AgentIntegrationMcpServerConfigDto[];
    }
  | Record<string, never> {
  const integrations = materializeAgentIntegrations({
    jobKey: params.jobKey,
    stepId: params.step.id,
    integrations: params.step.integrations,
    context: params.agentToolContext,
    snapshot: params.agentToolSnapshot,
  });
  if (integrations === undefined) return {};
  assertNoCustomMcpServerPrefixCollision(integrations, fields.customMcpServers);
  return {integrations, mcpServers: agentIntegrationMcpServers(integrations)};
}

// Authoring cannot know the default connection's slug, so the check repeats once it is resolved.
function assertNoCustomMcpServerPrefixCollision(
  integrations: readonly MaterializedAgentIntegrationConfigDto[],
  customMcpServers: CustomMcpServerResolution | undefined,
): void {
  const names = new Set(customMcpServers?.servers.map((server) => server.name));
  const collision = integrations.find((integration) =>
    names.has(sanitizeAgentIntegrationConnectionSlug(integration.connectionSlug)),
  );
  if (collision === undefined) return;
  throw new AgentIntegrationMaterializationError(
    `MCP server "${sanitizeAgentIntegrationConnectionSlug(collision.connectionSlug)}" has the same tool prefix as integration connection ${collision.connectionSlug}`,
    {reason: 'mcp-server-name-collision', connection: collision.connectionSlug},
  );
}

function customMcpServersConfig(
  fields: AgentFieldResolutions,
):
  | {readonly customMcpServers: readonly MaterializedAgentMcpServerConfigDto[]}
  | Record<string, never> {
  return fields.customMcpServers === undefined
    ? {}
    : {customMcpServers: fields.customMcpServers.servers};
}

function customMcpServerEnvPlan(
  fields: AgentFieldResolutions,
): {readonly customMcpServerEnv: CustomMcpServerEnvPlan} | Record<string, never> {
  const envPlan = fields.customMcpServers?.envPlan;
  return envPlan === undefined ? {} : {customMcpServerEnv: envPlan};
}

function agentIntegrationMcpServers(
  integrations: readonly MaterializedAgentIntegrationConfigDto[],
): readonly AgentIntegrationMcpServerConfigDto[] {
  return [
    {
      name: AGENT_INTEGRATION_MCP_SERVER_NAME,
      transport: AGENT_INTEGRATION_MCP_TRANSPORT,
      endpoint: AGENT_INTEGRATION_MCP_ENDPOINT,
      auth: AGENT_INTEGRATION_MCP_AUTH,
      integrations: [...integrations],
    },
  ];
}

function dispatchPlanField(field: FieldResolution): ResolvedField {
  const isResidual = field.kind === 'residual';
  return isResidual ? field.field : literalField(field.value);
}

function frozenFieldValue(field: FieldResolution | undefined): string | undefined {
  const isFrozen = field?.kind === 'frozen';
  return isFrozen ? field.value : undefined;
}

function resolveAgentField(params: {
  readonly field: AgentFieldName;
  readonly value: string;
  readonly template: ResolvedField['segments'] | undefined;
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly trace: WorkflowStepEvaluationTraceEntry[];
  readonly definitionId: string;
}): FieldResolution {
  const hasTemplate = params.template !== undefined;
  const usesAuthoredMode = params.mode === 'authored';
  if (!hasTemplate || usesAuthoredMode) {
    return {kind: 'frozen', value: params.value};
  }

  const resolved = resolveStepField({
    field: params.field,
    template: {segments: params.template},
    context: params.context,
    definitionId: params.definitionId,
    errorField: params.field,
  });
  params.diagnostics.push(
    ...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: params.field})),
  );
  params.trace.push(...resolved.trace.map((entry) => ({...entry, field: params.field})));
  return fieldResolution(resolved);
}

function resolveOptionalAgentField(params: {
  readonly field: AgentFieldName;
  readonly value: string | undefined;
  readonly template: ResolvedField['segments'] | undefined;
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly trace: WorkflowStepEvaluationTraceEntry[];
  readonly definitionId: string;
}): FieldResolution | undefined {
  const hasValue = params.value !== undefined;
  if (!hasValue) return undefined;
  return resolveAgentField({...params, value: params.value});
}

function fieldResolution(resolved: SiteResolvedField): FieldResolution {
  if (resolved.kind === 'residual') return {kind: 'residual', field: resolved.field};
  return {kind: 'frozen', value: resolved.value};
}

/** Reconstruct the authored source used by the attempt detail snapshot. */
function sessionKeySource(key: NonNullable<WorkflowModelAgentStep['session']>['key']): string {
  return key
    .map((segment) =>
      segment.kind === 'literal' ? segment.value : `\${{ ${segment.expression.source} }}`,
    )
    .join('');
}

function authoredSession(session: NonNullable<WorkflowModelAgentStep['session']>): {
  key: string;
  mode: 'resume' | 'fork';
} {
  return {key: sessionKeySource(session.key), mode: session.mode};
}

function resolveRepositoryContextFields(params: {
  readonly step: WorkflowModelAgentStep;
  readonly resolveTemplate: (args: {
    readonly source: string;
    readonly template: ResolvedField['segments'] | undefined;
  }) => FieldResolution;
}): RepositoryContextResolution | undefined {
  const authored = params.step.repositoryContext;
  if (authored === undefined) return undefined;
  const templates = params.step.templates;
  const {skills} = authored;
  return {
    instructions: resolveRepositoryContextToggle({
      value: authored.instructions,
      template: templates?.repositoryContextInstructions,
      resolveTemplate: params.resolveTemplate,
    }),
    skills:
      typeof skills === 'object'
        ? skills
        : resolveRepositoryContextToggle({
            value: skills,
            template: templates?.repositoryContextSkills,
            resolveTemplate: params.resolveTemplate,
          }),
  };
}

function resolveRepositoryContextToggle(params: {
  readonly value: boolean | string | undefined;
  readonly template: ResolvedField['segments'] | undefined;
  readonly resolveTemplate: Parameters<typeof resolveRepositoryContextFields>[0]['resolveTemplate'];
}): RepositoryContextToggleResolution {
  if (params.value === undefined) return {kind: 'literal', value: true};
  if (typeof params.value === 'boolean') return {kind: 'literal', value: params.value};
  return {
    kind: 'template',
    source: params.value,
    field: params.resolveTemplate({source: params.value, template: params.template}),
  };
}

function repositoryContextIsDeferred(resolution: RepositoryContextResolution | undefined): boolean {
  if (resolution === undefined) return false;
  return [resolution.instructions, resolution.skills].some(
    (toggle) => isRepositoryContextToggle(toggle) && toggleIsResidual(toggle),
  );
}

function repositoryContextDispatchPlan(
  resolution: RepositoryContextResolution,
  definitionId: string,
): RepositoryContextDispatchPlan {
  return {
    instructions: repositoryContextTogglePlan(resolution.instructions, definitionId),
    skills: isRepositoryContextToggle(resolution.skills)
      ? repositoryContextTogglePlan(resolution.skills, definitionId)
      : resolution.skills,
  };
}

function repositoryContextTogglePlan(
  toggle: RepositoryContextToggleResolution,
  definitionId: string,
): boolean | ResolvedField {
  if (toggle.kind === 'template' && toggle.field.kind === 'residual') return toggle.field.field;
  return frozenRepositoryContextToggle(toggle, definitionId);
}

function materializedRepositoryContextConfig(
  resolution: RepositoryContextResolution | undefined,
  definitionId: string,
): {readonly repositoryContext: AgentRepositoryContextConfigDto} | Record<string, never> {
  if (resolution === undefined) return {};
  return {
    repositoryContext: {
      instructions: frozenRepositoryContextToggle(resolution.instructions, definitionId),
      skills: isRepositoryContextToggle(resolution.skills)
        ? frozenRepositoryContextToggle(resolution.skills, definitionId)
        : [...resolution.skills],
    },
  };
}

function completeRepositoryContext(
  plan: RepositoryContextDispatchPlan,
  params: Parameters<typeof completeAgentField>[0]['params'],
): AgentRepositoryContextConfigDto {
  const completeToggle = (toggle: boolean | ResolvedField): boolean => {
    if (typeof toggle === 'boolean') return toggle;
    const value = completeAgentField({field: 'agent.repository_context', template: toggle, params});
    return parseRepositoryContextToggle({
      value,
      source: resolvedFieldSource(toggle),
      definitionId: params.definitionId,
    });
  };
  return {
    instructions: completeToggle(plan.instructions),
    skills: isSkillList(plan.skills) ? [...plan.skills] : completeToggle(plan.skills),
  };
}

function frozenRepositoryContextToggle(
  toggle: RepositoryContextToggleResolution,
  definitionId: string,
): boolean {
  if (toggle.kind === 'literal') return toggle.value;
  if (toggle.field.kind === 'residual') {
    throw new Error('Repository context template is still deferred');
  }
  return parseRepositoryContextToggle({
    value: toggle.field.value,
    source: toggle.source,
    definitionId,
  });
}

function parseRepositoryContextToggle(params: {
  readonly value: string;
  readonly source: string;
  readonly definitionId: string;
}): boolean {
  if (params.value === 'true') return true;
  if (params.value === 'false') return false;
  throw new InterpolationUnresolvableError(params.definitionId, {
    field: 'agent.repository_context',
    source: params.source,
    invalidValueReason: 'It must resolve to `true` or `false`',
  });
}

function isRepositoryContextToggle(
  value: RepositoryContextToggleResolution | readonly string[],
): value is RepositoryContextToggleResolution {
  return !Array.isArray(value);
}

function toggleIsResidual(toggle: RepositoryContextToggleResolution): boolean {
  return toggle.kind === 'template' && toggle.field.kind === 'residual';
}

function isSkillList(
  value: boolean | readonly string[] | ResolvedField,
): value is readonly string[] {
  return Array.isArray(value);
}

function resolvedFieldSource(field: ResolvedField): string {
  return field.segments
    .map((segment) =>
      segment.kind === 'literal' ? segment.value : `\${{ ${segment.expression.source} }}`,
    )
    .join('');
}

function readConfigString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

function readConfigThinking(config: Record<string, unknown>): AgentThinking | undefined {
  const value = config.thinking;
  return value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : undefined;
}

function readConfigHarness(
  config: Record<string, unknown>,
): WorkflowModelAgentStep['harness'] | undefined {
  return config.harness === 'pi' || config.harness === 'claude' ? config.harness : undefined;
}
