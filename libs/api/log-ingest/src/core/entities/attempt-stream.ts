/** Lifecycle state of an attempt's log stream. */
export type StreamState = 'open' | 'closed';

/** Why a stream was closed, once it is. */
export type StreamCloseReason = 'declared' | 'timeout';

/**
 * A single `(job, step, attempt)` log stream. Identity is scoped to the lease's
 * job. `committedLength` is the offset-CAS axis: raw NDJSON spool bytes the server
 * has durably accepted from the runner.
 */
export interface AttemptStream {
  id: string;
  jobId: string;
  stepId: string;
  attempt: number;
  workspaceId: string;
  committedLength: number;
  state: StreamState;
  closeReason: StreamCloseReason | null;
  declaredTotalBytes: number | null;
  truncated: boolean;
  objectKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}
