import type {WorkflowModel} from '@shipfox/api-definitions';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];

export interface MaterializedWorkflowJob {
  readonly sourceName: string;
  readonly dependencies: readonly string[];
  readonly runner: readonly string[];
  readonly position: number;
  readonly steps: readonly MaterializedWorkflowStep[];
}

export interface MaterializedWorkflowStep {
  readonly sourceName: string | null;
  readonly status: 'pending';
  readonly type: WorkflowModelStep['kind'];
  readonly config: Readonly<Record<string, unknown>>;
  readonly position: number;
}

export function materializeWorkflowModel(model: WorkflowModel): readonly MaterializedWorkflowJob[] {
  const jobsById = new Map(model.jobs.map((job) => [job.id, job]));

  return model.jobs.map((job, position) => ({
    sourceName: job.sourceName,
    dependencies: dependencySourceNames(job, jobsById),
    runner: job.runner,
    position,
    steps: job.steps.map((step, stepPosition) => ({
      sourceName: step.sourceName ?? null,
      status: 'pending',
      type: step.kind,
      config: stepConfig(step),
      position: stepPosition,
    })),
  }));
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

function stepConfig(step: WorkflowModelStep): Record<string, unknown> {
  return {
    run: step.command.value,
    ...(step.gate === undefined ? {} : {gate: stepGateConfig(step.gate)}),
  };
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
