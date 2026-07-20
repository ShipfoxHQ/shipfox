export function getResendRemainingSeconds(params: {
  nextResendAvailableAt: number | undefined;
  now: number;
}): number {
  if (!params.nextResendAvailableAt) return 0;

  return Math.max(0, Math.ceil((params.nextResendAvailableAt - params.now) / 1000));
}

export function parseNextResendAvailableAt(value: string): number | undefined {
  const nextAvailableAt = Date.parse(value);
  if (!Number.isFinite(nextAvailableAt)) return undefined;

  return nextAvailableAt;
}
