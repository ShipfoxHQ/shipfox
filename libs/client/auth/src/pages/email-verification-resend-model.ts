import {EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS} from '@shipfox/api-auth-dto';

export function getLocalResendAvailableAt(now: number): number {
  return now + EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000;
}

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
