export interface ProjectRouteParams {
  wid: string;
  pid: string;
}

export function projectRouteParams(input: Record<string, unknown>): ProjectRouteParams {
  const wid = stringParam(input.wid);
  const pid = stringParam(input.pid);
  if (!wid || !pid) throw new Error('Project route is missing required path parameters.');
  return {wid, pid};
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
