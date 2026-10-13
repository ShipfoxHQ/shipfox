export function cacheObjectKey(params: {
  prefix: string;
  workspaceId: string;
  projectId: string;
  entryId: string;
}): string {
  return `${params.prefix}/${params.workspaceId}/${params.projectId}/${params.entryId}`;
}
