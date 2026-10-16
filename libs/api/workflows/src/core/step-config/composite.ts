import type {
  WorkflowFieldTemplate,
  WorkflowModel,
  WorkflowModelActionInput,
} from '@shipfox/api-definitions-dto';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import type {WorkflowStepEvaluationTraceEntry, WorkflowStepTemplateDiagnostic} from './fields.js';
import {type ResolveRunStepConfigParams, resolveStepEnv} from './run.js';
import {resolveWith} from './tool.js';

type CompositeStep = Extract<WorkflowModel['jobs'][number]['steps'][number], {kind: 'composite'}>;

export interface CompositeStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

/**
 * Materializes the parent row of a composite action. The server opens it: the
 * `with` values become the typed inputs of the inner steps, and its own `env`
 * and working directory become their base. The output values are filled when
 * the last inner step finishes.
 */
export function resolveCompositeStepConfig(
  params: Omit<ResolveRunStepConfigParams, 'step'> & {readonly step: CompositeStep},
): CompositeStepConfig {
  const {step} = params;
  // Only the composite's own env: the inner steps already start from the workflow and job env.
  const env = resolveStepEnv({
    ...params,
    workflowEnv: undefined,
    workflowEnvTemplates: undefined,
    jobEnv: undefined,
    jobEnvTemplates: undefined,
  });
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
  const {composite} = step;

  return {
    config: {
      composite: {
        uses: composite.uses,
        origin: composite.origin,
        ...(composite.package === undefined ? {} : {package: composite.package}),
        ...(composite.version === undefined ? {} : {version: composite.version}),
        digest: composite.digest,
        name: composite.name,
        child_count: step.steps.length,
      },
      ...(inputs.value === undefined ? {} : {inputs: inputs.value}),
      ...(hasEnv ? {env: env.env} : {}),
    },
    configPlan: {
      action: {
        inputs: nonSecretInputs(composite.inputs),
        ...(inputs.plan === undefined ? {} : {with: inputs.plan}),
      },
      ...(hasEnvPlan ? {env: env.configPlan} : {}),
      composite: {outputs: compositeOutputValues(composite.outputs)},
    },
    diagnostics: env.diagnostics,
    trace: env.trace,
    hasTemplates: withTree !== undefined || env.hasTemplates,
  };
}

// Secret inputs were rewritten into the inner steps when the workflow synced, so they have no value here.
function nonSecretInputs(
  inputs: Readonly<Record<string, WorkflowModelActionInput>>,
): Readonly<Record<string, WorkflowModelActionInput>> {
  return Object.fromEntries(Object.entries(inputs).filter(([, input]) => input.secret !== true));
}

function compositeOutputValues(
  outputs: CompositeStep['composite']['outputs'],
): Readonly<Record<string, WorkflowFieldTemplate>> {
  return Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, output.value]));
}
