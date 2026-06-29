import {
  InvalidAgentModelError,
  UnsupportedAgentProviderError,
} from '@shipfox/api-agent/core/errors';
import {
  type AgentDefaultsResolver,
  catalogDefaultAgentResolver,
} from '@shipfox/api-agent/core/resolve-agent-config';
import type {MaterializedAgentStepConfigDto} from '@shipfox/api-agent-dto';
import type {WorkflowModel} from '@shipfox/api-definitions';
import {AgentConfigUnresolvableError} from '#core/errors.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowSourceLocation = NonNullable<WorkflowModelStep['sourceLocation']>;

const FIRST_LINE_PATTERN = /\r?\n/;
export interface MaterializedWorkflowJob {
  readonly sourceName: string;
  readonly dependencies: readonly string[];
  readonly runner: readonly string[];
  readonly position: number;
  readonly steps: readonly MaterializedWorkflowStep[];
}

export interface MaterializedWorkflowStep {
  readonly sourceName: string | null;
  readonly displayName: string;
  readonly sourceLocation: WorkflowSourceLocation | null;
  readonly status: 'pending';
  readonly type: WorkflowModelStep['kind'] | 'setup';
  readonly config: Readonly<Record<string, unknown>>;
  readonly position: number;
}

// Synthetic "Set up job" step prepended to every job at position 0, mirroring
// GitHub Actions' implicit setup step. The runner prepares the workspace here;
// failures report through the normal step protocol instead of hanging the job
// until the lease/timeout fires. Its config is credential-free.
const SETUP_STEP: MaterializedWorkflowStep = {
  sourceName: 'Set up job',
  displayName: 'Set up job',
  sourceLocation: null,
  status: 'pending',
  type: 'setup',
  config: {},
  position: 0,
};

export function materializeWorkflowModel(
  model: WorkflowModel,
  resolveAgentDefaults: AgentDefaultsResolver = catalogDefaultAgentResolver,
  definitionId = model.name,
): readonly MaterializedWorkflowJob[] {
  const jobsById = new Map(model.jobs.map((job) => [job.id, job]));

  return model.jobs.map((job, position) => ({
    sourceName: job.sourceName,
    dependencies: dependencySourceNames(job, jobsById),
    runner: job.runner,
    position,
    // Every job runs on a runner (scheduling never filters on the runner field),
    // so every job gets a setup step. User steps shift to position 1..n.
    steps: [
      SETUP_STEP,
      ...job.steps.map((step, stepPosition) => ({
        sourceName: step.sourceName ?? null,
        displayName: step.sourceName ?? stepDisplayName(step),
        sourceLocation: step.sourceLocation ?? null,
        status: 'pending' as const,
        type: step.kind,
        config: stepConfig(step, model.env, job.env, resolveAgentDefaults, definitionId),
        position: stepPosition + 1,
      })),
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
    return dependency.sourceName;
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

function stepConfig(
  step: WorkflowModelStep,
  workflowEnv: WorkflowModel['env'],
  jobEnv: WorkflowModelJob['env'],
  resolveAgentDefaults: AgentDefaultsResolver,
  definitionId: string,
): Record<string, unknown> {
  const gate = step.gate === undefined ? {} : {gate: stepGateConfig(step.gate)};
  const env = step.kind === 'run' ? mergedEnv(workflowEnv, jobEnv, step.env) : {};
  return step.kind === 'run'
    ? {run: step.command.value, ...env, ...gate}
    : {...agentStepConfig(step, resolveAgentDefaults, definitionId), ...gate};
}

function agentStepConfig(
  step: Extract<WorkflowModelStep, {kind: 'agent'}>,
  resolveAgentDefaults: AgentDefaultsResolver,
  definitionId: string,
): MaterializedAgentStepConfigDto {
  try {
    const resolved = resolveAgentDefaults({
      provider: step.provider,
      model: step.model,
      thinking: step.thinking,
    });
    return {...resolved, prompt: step.prompt};
  } catch (error) {
    if (error instanceof UnsupportedAgentProviderError || error instanceof InvalidAgentModelError) {
      throw new AgentConfigUnresolvableError(definitionId, {cause: error});
    }
    throw error;
  }
}

function mergedEnv(
  workflowEnv: WorkflowModel['env'],
  jobEnv: WorkflowModelJob['env'],
  stepEnv: Extract<WorkflowModelStep, {kind: 'run'}>['env'],
): {env: Readonly<Record<string, string>>} | Record<string, never> {
  const env = {...workflowEnv, ...jobEnv, ...stepEnv};
  return Object.keys(env).length === 0 ? {} : {env};
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workflow step kind: ${JSON.stringify(value)}`);
}

function stepGateConfig(gate: NonNullable<WorkflowModelStep['gate']>): Record<string, unknown> {
  return {
    ...(gate.successIf === undefined
      ? {}
      : {
          success_if: {
            language: gate.successIf.language,
            check: gate.successIf.check,
            source: gate.successIf.source,
          },
        }),
    ...(gate.onFailure === undefined
      ? {}
      : {
          on_failure: {
            restart_from: gate.onFailure.restartFrom,
            ...(gate.onFailure.output === undefined ? {} : {output: gate.onFailure.output}),
          },
        }),
  };
}
