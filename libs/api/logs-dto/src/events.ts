export const LOG_STREAM_CLOSED = 'logs.stream.closed' as const;

export interface LogStreamClosedEvent {
  workspaceId: string;
  jobId: string;
  stepId: string;
  attempt: number;
  streamId: string;
}

export interface LogsEventMap {
  [LOG_STREAM_CLOSED]: LogStreamClosedEvent;
}
