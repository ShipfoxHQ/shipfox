import type {JobStatus} from '../entities/job.js';
import type {RuntimeCompletionStatus} from '../workflow-scheduling/runtime-dag.js';

export function runtimeCompletionStatusForJob(status: JobStatus): RuntimeCompletionStatus {
  if (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'skipped'
  ) {
    return status;
  }
  throw new Error(`Job status is not terminal: ${status}`);
}
