export type JobListenerMatcherKind = 'on' | 'until';

export interface JobListenerSubscription {
  id: string;
  workspaceId: string;
  /** Null for subscriptions projected before the project was recorded; access is not checked. */
  projectId: string | null;
  workflowRunId: string;
  jobId: string;
  kind: JobListenerMatcherKind;
  matcherOrdinal: number;
  source: string;
  /** NULL is a source subscription: matches every event the source delivers. */
  event: string | null;
  config: Record<string, unknown>;
  createdAt: Date;
}
