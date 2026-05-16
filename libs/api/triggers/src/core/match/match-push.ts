export function matchPushBranch(ref: string, on: string | string[] | undefined): boolean {
  if (on === undefined) return true;
  if (typeof on === 'string') return on === ref;
  return on.includes(ref);
}
