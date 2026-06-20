export interface LogObjectKeyParams {
  workspaceId: string;
  jobId: string;
  stepId: string;
  attempt: number;
}

/**
 * Object layout `{prefix}/{workspace}/{job}/{step}/{attempt}` so retention and workspace
 * deletion are prefix operations. `prefix` is the configurable bucket prefix
 * (`LOG_STORAGE_S3_PREFIX`, default `logs`), so one bucket can host several modules.
 */
export function logObjectKey(
  prefix: string,
  {workspaceId, jobId, stepId, attempt}: LogObjectKeyParams,
): string {
  return `${prefix}/${workspaceId}/${jobId}/${stepId}/${attempt}`;
}
