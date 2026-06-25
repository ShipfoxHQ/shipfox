import type {RuntimeCompletionStatus, RuntimeDagJob} from './runtime-dag.js';

export type RuntimeSchedulingCommand<Job extends RuntimeDagJob = RuntimeDagJob> =
  | {
      readonly kind: 'start-job';
      readonly job: Job;
    }
  | {
      readonly kind: 'skip-job';
      readonly job: Job;
    }
  | {
      readonly kind: 'complete-run';
      readonly status: RuntimeCompletionStatus;
    };
