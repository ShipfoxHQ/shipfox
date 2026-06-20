import type {StreamKind} from '#schemas/stream-kind.js';

export const LOG_STREAM_CLOSED = 'logs.stream.closed' as const;

export interface LogStreamClosedEvent {
  workspaceId: string;
  jobId: string;
  stepId: string;
  attempt: number;
  streamId: string;
  /** Stream kind, so consumers (compaction, projection) branch without a lookup. */
  kind: StreamKind;
}

export interface LogsEventMap {
  [LOG_STREAM_CLOSED]: LogStreamClosedEvent;
}
