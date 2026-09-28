import type {WorkflowModel, WorkflowModelActionInput} from '@shipfox/api-definitions-dto';
import {coerceStepOutputs, type StepOutputCoercionError} from '@shipfox/expression';
import type {PersistedEvaluationTraceEntry, StepConfigDispatchPlan} from '#core/entities/step.js';
import {ActionInputInvalidError} from '#core/errors.js';
import type {WorkflowStepEvaluationTraceEntry, WorkflowStepTemplateDiagnostic} from './fields.js';
import {type ResolveRunStepConfigParams, resolveStepEnv} from './run.js';
import {completeWith, resolveWith} from './tool.js';
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
  params: Omit<ResolveRunStepConfigParams, 'step'> & {readonly step: ActionStep},
): ActionStepConfig {
  const {step} = params;
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
      ...(inputs.value === undefined ? {} : {inputs: inputs.value}),
      ...(hasEnv ? {env: env.env} : {}),
      integrations: Object.entries(step.action.integrations).map(([alias, integration]) => ({
        alias,
        provider: integration.provider,
        connection_slug: integration.connection,
      })),
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

export function completeActionConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const actionPlan = params.plan.action;
  if (actionPlan === undefined) return;

  const provided = completeWith(params.config.inputs, actionPlan.with, {
    field: 'action.with',
    context: params.context,
    definitionId: params.definitionId,
    trace: params.trace,
  });
  params.config.inputs = coerceActionInputs(actionPlan.inputs, provided);
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
