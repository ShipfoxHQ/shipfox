/** What a cache request takes from the job lease. Bodies never name any of it. */
export interface CacheLease {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  jobExecutionId: string;
}
