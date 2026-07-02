import {
  type AgentDefaultsResolver,
  catalogDefaultAgentResolver,
} from '@shipfox/api-agent/core/resolve-agent-config';
import type {WorkflowModel} from '@shipfox/api-definitions';
import type {WorkflowContextPhase, WorkflowExpressionEvaluationContext} from '@shipfox/expression';
import {resolveStepConfig, type WorkflowStepTemplateDiagnostic} from './resolve-step-config.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowSourceLocation = NonNullable<WorkflowModelStep['sourceLocation']>;

const FIRST_LINE_PATTERN = /\r?\n/;
export interface MaterializedWorkflowJob {
  readonly key: string;
  readonly mode: WorkflowModelJob['mode'];
  readonly success?: string;
  readonly executionTimeoutMs?: number;
  readonly checkout: WorkflowModelJob['checkout'];
  readonly listening?: WorkflowModelJob['listening'];
  readonly name?: WorkflowModelJob['name'];
  readonly dependencies: readonly string[];
  readonly runner: readonly string[];
  readonly position: number;
  readonly steps: readonly MaterializedWorkflowStep[];
}

export interface MaterializedWorkflowStep {
  readonly key: string | null;
  readonly name: string;
  readonly sourceLocation: WorkflowSourceLocation | null;
  readonly status: 'pending';
  readonly type: WorkflowModelStep['kind'] | 'setup';
  readonly config: Readonly<Record<string, unknown>>;
  readonly authoredConfig: Readonly<Record<string, unknown>> | null;
  readonly diagnostics?: readonly WorkflowStepTemplateDiagnostic[];
  readonly position: number;
}

// Synthetic "Set up job" step prepended to every job at position 0, mirroring
// GitHub Actions' implicit setup step. The runner prepares the workspace here;
// failures report through the normal step protocol instead of hanging the job
// until the lease/timeout fires. Its config is credential-free.
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

export interface MaterializeWorkflowModelParams {
  readonly model: WorkflowModel;
  readonly context?: WorkflowExpressionEvaluationContext;
  readonly phase?: WorkflowContextPhase | undefined;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId?: string | undefined;
}

export function materializeWorkflowModel(
  params: MaterializeWorkflowModelParams,
): readonly MaterializedWorkflowJob[] {
  const {
    model,
    context = {},
    phase = 'workflow-run-creation',
    resolveAgentDefaults = catalogDefaultAgentResolver,
    definitionId = model.name,
  } = params;
  const jobsById = new Map(model.jobs.map((job) => [job.id, job]));

  return model.jobs.map((job, position) => ({
    key: job.key,
    mode: job.mode,
    ...(job.success === undefined ? {} : {success: job.success}),
    ...(job.executionTimeoutMs === undefined ? {} : {executionTimeoutMs: job.executionTimeoutMs}),
    checkout: job.checkout,
    ...(job.listening === undefined ? {} : {listening: job.listening}),
    ...(job.name === undefined ? {} : {name: job.name}),
    dependencies: dependencySourceNames(job, jobsById),
    runner: job.runner,
    position,
    // Every job runs on a runner (scheduling never filters on the runner field),
    // so every job gets a setup step. User steps shift to position 1..n.
    steps: [
      SETUP_STEP,
      ...job.steps.map((step, stepPosition) => {
        // The trusted context exposes the stable job key; the authored display field remains `job.name`.
        const stepContext = {...context, job: {key: job.key}};
        const resolved = resolveStepConfig({
          step,
          workflowEnv: model.env,
          workflowEnvTemplates: model.templates?.env,
          jobEnv: job.env,
          jobEnvTemplates: job.templates?.env,
          context: stepContext,
          phase,
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
          ...(resolved.diagnostics.length === 0 ? {} : {diagnostics: resolved.diagnostics}),
          position: stepPosition + 1,
        };
      }),
    ],
  }));
}

export function modelHasAgentStep(model: WorkflowModel): boolean {
  return model.jobs.some((job) => job.steps.some((step) => step.kind === 'agent'));
}

function dependencySourceNames(
  job: WorkflowModelJob,
  jobsById: ReadonlyMap<string, WorkflowModelJob>,
): readonly string[] {
  return job.dependencies.map((dependencyId) => {
    const dependency = jobsById.get(dependencyId);
    if (!dependency) {
      throw new Error(`Unresolved workflow model dependency "${dependencyId}" for job "${job.id}"`);
    }
    return dependency.key;
  });
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
