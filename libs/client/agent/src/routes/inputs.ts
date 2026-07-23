export function modelProviderRouteParams(input: Record<string, unknown>): {wid: string} {
  const wid = stringParam(input.wid);
  if (!wid) throw new Error('Model provider route is missing the workspace path parameter.');
  return {wid};
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
