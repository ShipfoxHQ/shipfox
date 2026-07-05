import {CronExpressionParser} from 'cron-parser';

export interface ComputeNextFireAtParams {
  readonly cronExpression: string;
  readonly timezone: string;
  readonly from: Date;
  readonly subscriptionId: string;
  readonly jitterWindowSeconds: number;
}

export function computeNextFireAt(params: ComputeNextFireAtParams): Date {
  const iterator = CronExpressionParser.parse(params.cronExpression, {
    currentDate: params.from,
    tz: params.timezone,
  });
  const occurrence = iterator.next().toDate();
  const following = iterator.next().toDate();
  const gapMs = following.getTime() - occurrence.getTime();
  const offsetMs = jitterOffsetMs(params.subscriptionId, params.jitterWindowSeconds, gapMs);
  return new Date(occurrence.getTime() + offsetMs);
}

function jitterOffsetMs(subscriptionId: string, windowSeconds: number, gapMs: number): number {
  const windowMs = Math.floor(windowSeconds * 1000);
  const clampMs = Math.min(windowMs, gapMs);
  if (clampMs <= 0) return 0;
  return hashStringToUint32(subscriptionId) % clampMs;
}

function hashStringToUint32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
