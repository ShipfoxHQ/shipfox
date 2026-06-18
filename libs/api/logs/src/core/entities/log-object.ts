export interface LogObjectKeyParams {
  workspaceId: string;
  jobId: string;
  stepId: string;
  attempt: number;
}

/** Object layout `logs/{workspace}/{job}/{step}/{attempt}` so retention and workspace deletion are prefix operations. */
export function logObjectKey({workspaceId, jobId, stepId, attempt}: LogObjectKeyParams): string {
  return `logs/${workspaceId}/${jobId}/${stepId}/${attempt}`;
}
