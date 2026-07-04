import {
  type AgentDefaultsResolver,
  catalogDefaultAgentResolver,
} from '@shipfox/api-agent/core/resolve-agent-config';
import type {WorkflowModel} from '@shipfox/api-definitions';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {resolveStepConfig, type WorkflowStepTemplateDiagnostic} from './resolve-step-config.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowSourceLocation = NonNullable<WorkflowModelStep['sourceLocation']>;

const FIRST_LINE_PATTERN = /\r?\n/;

export interface MaterializedWorkflowStep {
  readonly key: string | null;
  readonly name: string;
  readonly sourceLocation: WorkflowSourceLocation | null;
  readonly status: 'pending';
  readonly type: WorkflowModelStep['kind'] | 'setup';
  readonly config: Readonly<Record<string, unknown>>;
  readonly configPlan?: StepConfigDispatchPlan;
  readonly authoredConfig: Readonly<Record<string, unknown>> | null;
  readonly diagnostics?: readonly WorkflowStepTemplateDiagnostic[];
  readonly position: number;
}

export interface MaterializeJobExecutionStepsParams {
  readonly model: WorkflowModel;
  readonly job: WorkflowModelJob;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId?: string | undefined;
}

// Synthetic "Set up job" step prepended when a job execution's steps are materialized.
// The runner prepares the workspace here; failures report through the normal step
// protocol instead of hanging the job until the lease/timeout fires. Its config is
// credential-free.
const SETUP_STEP: MaterializedWorkflowStep = {
  key: null,
  name: 'Set up job',
  sourceLocation: null,
  status: 'pending',
  type: 'setup',
  config: {},
  authoredConfig: null,
  position: 0,
};

export function materializeJobExecutionSteps(
  params: MaterializeJobExecutionStepsParams,
): readonly MaterializedWorkflowStep[] {
  const {
    model,
    job,
    context,
    resolveAgentDefaults = catalogDefaultAgentResolver,
    definitionId = model.name,
  } = params;

  return [
    SETUP_STEP,
    ...job.steps.map((step, stepPosition) => {
      // The trusted context exposes the stable job key; the authored display field remains `job.name`.
      const stepContext = {...context.values, job: {key: job.key}};
      const resolved = resolveStepConfig({
        step,
        workflowEnv: model.env,
        workflowEnvTemplates: model.templates?.env,
        jobEnv: job.env,
        jobEnvTemplates: job.templates?.env,
        context: stepContext,
        site: context.site,
        resolveAgentDefaults,
        definitionId,
      });
      return {
        key: step.key ?? null,
        name: resolved.name ?? stepDisplayName(step),
        sourceLocation: step.sourceLocation ?? null,
        status: 'pending' as const,
        type: step.kind,
        config: resolved.config,
        authoredConfig: resolved.authoredConfig,
        ...(resolved.configPlan === null ? {} : {configPlan: resolved.configPlan}),
        ...(resolved.diagnostics.length === 0 ? {} : {diagnostics: resolved.diagnostics}),
        position: stepPosition + 1,
      };
    }),
  ];
}

function stepDisplayName(step: WorkflowModelStep): string {
  switch (step.kind) {
    case 'run':
      return firstLine(step.command.value);
    case 'agent':
      return step.model === undefined
        ? firstLine(step.prompt)
        : `${step.model} · ${firstLine(step.prompt)}`;
    default:
      return assertNever(step);
  }
}

function firstLine(value: string): string {
  return value.split(FIRST_LINE_PATTERN, 1)[0]?.trim() || value.trim();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workflow step kind: ${JSON.stringify(value)}`);
}
