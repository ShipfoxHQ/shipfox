export const GATEWAY_BACKOFF_MIN_MS = 5_000;
export const GATEWAY_BACKOFF_MAX_MS = 5 * 60_000;

const JITTER_SPAN = 0.1;

/**
 * Exponential delay from 5 s up to 5 minutes. The jitter only shortens the delay, so a permanent
 * crash loop stays close to one Identify per 5 minutes.
 */
export function gatewayBackoffMs(params: {attempt: number; random?: () => number}): number {
  const ceiling = Math.min(GATEWAY_BACKOFF_MAX_MS, GATEWAY_BACKOFF_MIN_MS * 2 ** params.attempt);
  const random = params.random ?? Math.random;
  return Math.round(ceiling * (1 - JITTER_SPAN * random()));
}
