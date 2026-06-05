export type RuntimeCommand = StartJobCommand | CancelJobCommand | CompleteRunCommand;

export interface StartJobCommand {
  type: 'start_job';
  jobId: string;
}

export interface CancelJobCommand {
  type: 'cancel_job';
  jobId: string;
}

export interface CompleteRunCommand {
  type: 'complete_run';
  status: 'succeeded' | 'failed';
}
