export type RuntimeEvent = RunStartedEvent | JobCompletedEvent;

export interface RunStartedEvent {
  type: 'run_started';
}

export interface JobCompletedEvent {
  type: 'job_completed';
  jobId: string;
  status: 'succeeded' | 'failed';
}
