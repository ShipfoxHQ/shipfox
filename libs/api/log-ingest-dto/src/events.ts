export const LOG_STREAM_CLOSED = 'log_ingest.stream.closed' as const;

export interface LogStreamClosedEvent {
  workspaceId: string;
  jobId: string;
  stepId: string;
  attempt: number;
  streamId: string;
}

export interface LogIngestEventMap {
  [LOG_STREAM_CLOSED]: LogStreamClosedEvent;
}
