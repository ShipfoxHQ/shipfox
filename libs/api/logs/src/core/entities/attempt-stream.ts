import type {StreamKind} from '@shipfox/api-logs-dto';

/** Lifecycle state of an attempt's log stream. */
export type StreamState = 'open' | 'closed';

/** Why a stream was closed, once it is. */
export type StreamCloseReason = 'declared' | 'timeout';

/**
 * A single `(job, step, attempt, kind)` log stream. Identity is scoped to the
 * lease's job, and `kind` is part of identity so a step may carry both a
 * `log_stream` and an `agent_session`. `workspaceId`, `projectId`, and `runId`
 * are stamped from the lease on stream creation and asserted on subsequent
 * appends, so reads can authorize per-project without joining back to workflows.
 * `committedLength` is the offset-CAS axis: raw NDJSON spool bytes the server has
 * durably accepted from the runner.
 *
 * `truncated` and `capped` are out-of-band terminal flags. For `agent_session`
 * they are the only capped/truncated signal (no in-band tombstone is injected);
 * `capped` is a JOB-level signal ("the job's shared budget was exhausted, so this
 * stream may be incomplete"), not "this stream lost bytes".
 */
export interface AttemptStream {
  id: string;
  jobId: string;
  stepId: string;
  attempt: number;
  kind: StreamKind;
  workspaceId: string;
  projectId: string;
  runId: string;
  committedLength: number;
  state: StreamState;
  closeReason: StreamCloseReason | null;
  declaredTotalBytes: number | null;
  truncated: boolean;
  capped: boolean;
  objectKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** When the stream was closed (either close path); null while open. Retention anchor. */
  closedAt: Date | null;
}
