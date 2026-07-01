export type JobListenerMatcherKind = 'on' | 'until';

export interface JobListenerSubscription {
  id: string;
  workspaceId: string;
  workflowRunId: string;
  jobId: string;
  kind: JobListenerMatcherKind;
  matcherOrdinal: number;
  source: string;
  event: string;
  config: Record<string, unknown>;
  createdAt: Date;
}
