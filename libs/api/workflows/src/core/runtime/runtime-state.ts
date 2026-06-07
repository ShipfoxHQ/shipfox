export type RuntimeRunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type RuntimeJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RuntimeState {
  run: RuntimeRunState;
  jobs: RuntimeJobState[];
}

export interface RuntimeRunState {
  status: RuntimeRunStatus;
}

export interface RuntimeJobState {
  id: string;
  name: string;
  dependencies: string[];
  status: RuntimeJobStatus;
}

export function createInitialRuntimeState(params: {
  jobs: Array<{id: string; name: string; dependencies: string[]}>;
}): RuntimeState {
  return {
    run: {status: 'pending'},
    jobs: params.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      dependencies: [...job.dependencies],
      status: 'pending',
    })),
  };
}
