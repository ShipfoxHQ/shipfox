/** Lifecycle state of an attempt's log stream. */
export type StreamState = 'open' | 'closed';

/** Why a stream was closed, once it is. */
export type StreamCloseReason = 'declared' | 'timeout';

/**
 * A single `(job, step, attempt)` log stream. Identity is scoped to the lease's
 * job. `workspaceId`, `projectId`, and `runId` are stamped from the lease on
 * stream creation and asserted on subsequent appends, so reads can authorize
 * per-project without joining back to workflows. `committedLength` is the
 * offset-CAS axis: raw NDJSON spool bytes the server has durably accepted from
 * the runner.
 */
export interface AttemptStream {
  id: string;
  jobId: string;
  stepId: string;
  attempt: number;
  workspaceId: string;
  projectId: string;
  runId: string;
  committedLength: number;
  state: StreamState;
  closeReason: StreamCloseReason | null;
  declaredTotalBytes: number | null;
  truncated: boolean;
  objectKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** When the stream was closed (either close path); null while open. Retention anchor. */
  closedAt: Date | null;
}
