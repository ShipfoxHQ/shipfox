import {WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS} from '@shipfox/api-definitions-dto';
import {
  type AgentStepSessionIntentDto,
  agentStepSessionDescriptorSchema,
  assertWorkingDirectory,
} from '@shipfox/api-workflows-dto';
import {capTraceEntries} from '@shipfox/expression';
import {Ajv, type AnySchema} from 'ajv';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {
  PersistedEvaluationTraceEntry,
  Step,
  StepConfigDispatchPlan,
} from '#core/entities/step.js';
import {AgentStepSessionClaimError, ToolConfigInvalidError} from '#core/errors.js';
import {completeActionConfig} from './action.js';
import {completeAgentConfig, readAgentStepSessionIntent} from './agent.js';
import {completeStepFieldWithTrace} from './fields.js';
import {completeRunDispatchConfig} from './run.js';
import {assertSecretInputDestinations, completeWith} from './tool.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

/** True when any deferred segment in the plan reads `root`. */
export function planReadsContext(plan: StepConfigDispatchPlan | null, root: string): boolean {
  return valueReadsContext(plan, root);
}

function valueReadsContext(value: unknown, root: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => valueReadsContext(entry, root));
  if (value === null || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  if (record.kind === 'deferred') return Array.isArray(record.roots) && record.roots.includes(root);
  return Object.values(record).some((entry) => valueReadsContext(entry, root));
}

export async function completeStepDispatchConfig(params: {
  readonly step: Step;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
}): Promise<{
  readonly config: Record<string, unknown>;
  readonly trace: readonly PersistedEvaluationTraceEntry[];
  readonly sessionIntent: AgentStepSessionIntentDto | undefined;
}> {
  const plan = params.step.configPlan;
  if (plan === null) {
    if (params.step.type === 'tool') {
      completeToolConfig({
        config: params.step.config,
        plan: {},
        context: params.context,
        definitionId: params.definitionId,
        trace: [],
        authoredWith: authoredToolWith(params.step),
      });
    }
    assertWorkingDirectoryIfPresent(params.step.config.working_directory);
    return {
      config: params.step.config,
      trace: [],
      sessionIntent: validateSessionConfig(params.step.config),
    };
  }

  const config = {...params.step.config};
  delete config.secret_bindings;
  const trace: PersistedEvaluationTraceEntry[] = [...(plan.trace ?? [])];
  completeToolConfig({
    config,
    plan,
    definitionId: params.definitionId,
    context: params.context,
    trace,
    authoredWith: authoredToolWith(params.step),
  });
  completeRunDispatchConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  completeActionConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  const completedSessionIntent = await completeAgentConfig({
    config,
    plan,
    context: params.context,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
    trace,
  });
  completeWorkingDirectoryConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  completeCheckoutConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  assertWorkingDirectoryIfPresent(config.working_directory);

  return {
    config,
    trace: capTraceEntries(trace),
    sessionIntent: validateSessionConfig(config) ?? completedSessionIntent,
  };
}

function validateSessionConfig(
  config: Record<string, unknown>,
): AgentStepSessionIntentDto | undefined {
  const rawSession = config.session;
  if (rawSession === undefined || rawSession === null) return undefined;

  const intent = readAgentStepSessionIntent(config);
  if (intent !== undefined) return intent;
  if (agentStepSessionDescriptorSchema.safeParse(rawSession).success) return undefined;

  throw new AgentStepSessionClaimError(
    'agent_session_key_invalid',
    'Agent session configuration is invalid',
  );
}

function completeToolConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: Step['configPlan'] & object;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
  readonly authoredWith: unknown;
}): void {
  const toolPlan = params.plan.tool;
  const tool = params.config.tool;
  if (toolPlan === undefined && (tool === undefined || tool === null)) return;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) {
    throw new ToolConfigInvalidError('Tool dispatch config is missing an object');
  }
  const toolConfig = {...tool} as Record<string, unknown>;
  const baseWith = toolConfig.with;
  const mergedWith = completeWith(baseWith, toolPlan?.with, {...params, field: 'tool.with'});
  toolConfig.with = mergedWith;
  assertSecretInputDestinations({
    toolId: dispatchToolId(toolConfig),
    authoredWith: params.authoredWith,
    resolvedWith: mergedWith,
  });
  const method = toolConfig.method;
  const input = toolConfig.with ?? {};
  if (method !== undefined && (typeof input !== 'object' || Array.isArray(input))) {
    throw new ToolConfigInvalidError(
      'Tool input is invalid: expected an object when a method is selected',
    );
  }
  const inputWithMethod =
    method === undefined ? input : {...(input as Record<string, unknown>), method};
  const ajv = new Ajv({
    strict: true,
    // Provider schemas carry `format` keywords such as `date-time`. Strict mode rejects a format
    // it has no plugin for, and the provider checks the value itself.
    validateFormats: false,
    strictRequired: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  let valid = false;
  try {
    const validate = ajv.compile(toolConfig.input_schema as AnySchema);
    valid = validate(inputWithMethod) === true;
  } catch (error) {
    throw new ToolConfigInvalidError(
      `Tool input schema is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!valid) throw new ToolConfigInvalidError(`Tool input is invalid: ${ajv.errorsText()}`);
  if (method !== undefined) toolConfig.with = inputWithMethod;
  params.config.tool = toolConfig;
}

function authoredToolWith(step: Step): unknown {
  const source = step.authoredConfig ?? step.config;
  const tool = source.tool;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return undefined;
  return (tool as Record<string, unknown>).with;
}

function dispatchToolId(toolConfig: Record<string, unknown>): string {
  if (toolConfig.provider === 'shipfox' && toolConfig.id === 'start_workflow_run') {
    return 'shipfox.start_workflow_run';
  }
  return typeof toolConfig.id === 'string' ? toolConfig.id : '';
}

function completeCheckoutConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: Step['configPlan'] & object;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const checkoutPlan = params.plan.checkout;
  if (checkoutPlan === undefined) return;

  const checkout = params.config.checkout;
  if (checkout === null || typeof checkout !== 'object' || Array.isArray(checkout)) {
    throw new Error('Checkout dispatch config is missing an object');
  }

  const resolvedCheckout = {...checkout} as Record<string, unknown>;
  params.config.checkout = resolvedCheckout;

  for (const [key, fieldName] of WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS) {
    const field = checkoutPlan[key];
    if (field === undefined) continue;

    const resolved = completeStepFieldWithTrace({
      field: fieldName,
      template: field,
      context: params.context,
      definitionId: params.definitionId,
      errorField: fieldName,
    });
    resolvedCheckout[key] = resolved.value;
    params.trace.push(...resolved.trace.map((entry) => ({...entry, field: fieldName})));
  }
}

function assertWorkingDirectoryIfPresent(value: unknown): void {
  if (value !== undefined) assertWorkingDirectory(value);
}

function completeWorkingDirectoryConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: Step['configPlan'] & object;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const field = params.plan.working_directory;
  if (field === undefined) return;

  const resolved = completeStepFieldWithTrace({
    field: 'step.working_directory',
    template: field,
    context: params.context,
    definitionId: params.definitionId,
    errorField: 'step.working_directory',
  });
  params.config.working_directory = resolved.value;
  params.trace.push(
    ...resolved.trace.map((entry) => ({...entry, field: 'step.working_directory' as const})),
  );
}
