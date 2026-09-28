import type {
  WorkflowJsonTemplateTree,
  WorkflowModel,
  WorkflowModelActionInput,
} from '@shipfox/api-definitions-dto';
import type {MaterializedSecretBindingDto} from '@shipfox/api-secrets-dto';
import {
  coerceStepOutputs,
  type ResolvedFieldSegment,
  type StepOutputCoercionError,
} from '@shipfox/expression';
import {
  type AgentToolMaterializationContext,
  type AgentToolMaterializationSnapshot,
  type MaterializedActionIntegration,
  type MaterializedActionTool,
  materializeActionIntegrations,
} from '#core/agent-tools.js';
import type {PersistedEvaluationTraceEntry, StepConfigDispatchPlan} from '#core/entities/step.js';
import {ActionInputInvalidError, AgentIntegrationMaterializationError} from '#core/errors.js';
import type {WorkflowStepEvaluationTraceEntry, WorkflowStepTemplateDiagnostic} from './fields.js';
import {completeDispatchField, type ResolveRunStepConfigParams, resolveStepEnv} from './run.js';
import {completeWith, isFieldTemplate, resolveWith} from './tool.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type ActionStep = Extract<WorkflowModel['jobs'][number]['steps'][number], {kind: 'action'}>;
type ActionInputDeclarations = Readonly<Record<string, WorkflowModelActionInput>>;

export interface ActionStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

/**
 * Materializes an action step. `inputs` holds the `with` values known at run
 * creation; dispatch fills the rest, applies defaults, and types every value.
 */
export function resolveActionStepConfig(
  params: Omit<ResolveRunStepConfigParams, 'step'> & {
    readonly step: ActionStep;
    readonly jobKey: string;
    readonly agentToolContext?: AgentToolMaterializationContext | undefined;
    readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
  },
): ActionStepConfig {
  const {step} = params;
  const grants = materializeActionIntegrations({
    jobKey: params.jobKey,
    stepId: step.id,
    integrations: step.action.integrations,
    context: params.agentToolContext,
    snapshot: params.agentToolSnapshot,
  });
  const env = resolveStepEnv(params);
  const withTree = step.templates?.with;
  const inputs =
    withTree === undefined || params.mode === 'authored'
      ? {value: step.with}
      : resolveWith({
          field: 'action.with',
          value: step.with,
          tree: withTree,
          context: params.context,
          definitionId: params.definitionId,
        });
  const hasEnv = Object.keys(env.env).length > 0;
  const hasEnvPlan = Object.keys(env.configPlan).length > 0;

  return {
    config: {
      action: {
        uses: step.action.uses,
        digest: step.action.digest,
        main: step.action.main,
        name: step.action.name,
      },
      // The runner hands it to the action as `context.jobKey`.
      job_key: params.jobKey,
      ...(inputs.value === undefined ? {} : {inputs: inputs.value}),
      ...(hasEnv ? {env: env.env} : {}),
      integrations: Object.keys(step.action.integrations).map((alias) =>
        actionIntegrationConfig(alias, grants[alias]),
      ),
    },
    configPlan: {
      action: {
        inputs: step.action.inputs,
        ...(inputs.plan === undefined ? {} : {with: inputs.plan}),
      },
      ...(hasEnvPlan ? {env: env.configPlan} : {}),
    },
    diagnostics: env.diagnostics,
    trace: env.trace,
    hasTemplates: withTree !== undefined || env.hasTemplates,
  };
}

function actionIntegrationConfig(
  alias: string,
  grant: MaterializedActionIntegration | undefined,
): Record<string, unknown> {
  if (grant === undefined) {
    throw new AgentIntegrationMaterializationError(
      `Action integration ${alias} is missing from the frozen tool grants`,
    );
  }
  return {
    alias,
    provider: grant.provider,
    connection_slug: grant.connectionSlug,
    tools: grant.tools.map(actionToolConfig),
  };
}

function actionToolConfig(tool: MaterializedActionTool): Record<string, unknown> {
  return {
    id: tool.id,
    sensitivity: tool.sensitivity,
    result: tool.result,
    input_schema: tool.inputSchema,
    ...(tool.methods === undefined
      ? {}
      : {
          methods: tool.methods.map((method) => ({id: method.id, sensitivity: method.sensitivity})),
        }),
  };
}

export function completeActionConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const actionPlan = params.plan.action;
  if (actionPlan === undefined) return;

  const {secretInputs, withPlan} = splitSecretInputs(actionPlan.with);
  const secretBindings = completeSecretInputs({
    ...params,
    declarations: actionPlan.inputs,
    secretInputs,
  });
  const provided = completeWith(params.config.inputs, withPlan, {
    field: 'action.with',
    context: params.context,
    definitionId: params.definitionId,
    trace: params.trace,
  });
  const declarations = withoutSecretInputs(actionPlan.inputs, secretInputs);
  params.config.inputs = coerceActionInputs(declarations, provided);
  if (secretBindings.length === 0) return;

  const existing = Array.isArray(params.config.secret_bindings)
    ? params.config.secret_bindings
    : [];
  params.config.secret_bindings = [...existing, ...secretBindings];
}

type SecretInputTemplates = Readonly<Record<string, readonly ResolvedFieldSegment[]>>;

// Normalization only accepts a secret as the whole value of a top-level input.
function splitSecretInputs(plan: WorkflowJsonTemplateTree | undefined): {
  readonly secretInputs: SecretInputTemplates;
  readonly withPlan: WorkflowJsonTemplateTree | undefined;
} {
  if (plan === undefined || plan === null || Array.isArray(plan) || typeof plan !== 'object') {
    return {secretInputs: {}, withPlan: plan};
  }

  const secretInputs: Record<string, readonly ResolvedFieldSegment[]> = {};
  const withPlan: Record<string, WorkflowJsonTemplateTree> = {};
  for (const [name, child] of Object.entries(plan as Record<string, WorkflowJsonTemplateTree>)) {
    if (child !== undefined && isFieldTemplate(child) && readsSecrets(child)) {
      secretInputs[name] = child;
    } else {
      withPlan[name] = child;
    }
  }
  return {secretInputs, withPlan};
}

function readsSecrets(segments: readonly ResolvedFieldSegment[]): boolean {
  return segments.some(
    (segment) => segment.kind === 'deferred' && segment.roots.includes('secrets'),
  );
}

function completeSecretInputs(params: {
  readonly declarations: ActionInputDeclarations;
  readonly secretInputs: SecretInputTemplates;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): MaterializedSecretBindingDto[] {
  const bindings: MaterializedSecretBindingDto[] = [];
  for (const [name, segments] of Object.entries(params.secretInputs)) {
    // The runner fills the secret as a string, so the input must accept one as is.
    if (params.declarations[name]?.type !== 'string') {
      throw new ActionInputInvalidError(
        `Action input "${name}" receives a secret, so it must be a string input.`,
        name,
      );
    }
    const completed = completeDispatchField({
      field: 'action.with',
      traceField: 'action.with',
      errorField: 'action.with',
      template: {segments},
      context: params.context,
      definitionId: params.definitionId,
      target: {kind: 'input', name},
      trace: params.trace,
    });
    if (completed.kind !== 'binding') {
      throw new Error(`Action secret input "${name}" resolved outside the runner`);
    }
    bindings.push(completed.binding);
  }
  return bindings;
}

function withoutSecretInputs(
  declarations: ActionInputDeclarations,
  secretInputs: SecretInputTemplates,
): ActionInputDeclarations {
  return Object.fromEntries(
    Object.entries(declarations).filter(([name]) => !Object.hasOwn(secretInputs, name)),
  );
}

// Defaults apply only to omitted inputs, never to null or empty values.
function coerceActionInputs(
  declarations: ActionInputDeclarations,
  provided: unknown,
): Record<string, unknown> {
  const values: Record<string, unknown> =
    provided !== null && typeof provided === 'object' && !Array.isArray(provided)
      ? {...provided}
      : {};
  for (const [name, input] of Object.entries(declarations)) {
    if (!Object.hasOwn(values, name) && input.default !== undefined) values[name] = input.default;
  }

  const result = coerceStepOutputs({declarations, output: values});
  if (result.ok) return result.output;
  throw new ActionInputInvalidError(inputErrorMessage(result.error), result.error.key);
}

function inputErrorMessage(error: StepOutputCoercionError): string {
  const input = `Action input "${error.key}"`;
  switch (error.reason) {
    case 'missing':
      return `${input} is required.`;
    case 'undeclared':
      return `${input} is not declared by the action.`;
    case 'invalid_json':
      return `${input} must be valid JSON.`;
    case 'schema_invalid':
      return `${input} does not match its JSON Schema: ${error.schemaError ?? 'invalid value'}.`;
    case 'invalid_type':
      return `${input} must be a ${error.expectedType ?? 'valid'} value.`;
  }
}
