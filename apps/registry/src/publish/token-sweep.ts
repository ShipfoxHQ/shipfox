import {logger} from '@shipfox/node-opentelemetry';
import {sweepExpiredTokens} from '#publish/used-tokens.js';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** Deletes expired used-token rows now and then, every `intervalMs`. Returns a function that stops it. */
export function startTokenSweep({intervalMs = SWEEP_INTERVAL_MS}: {intervalMs?: number} = {}) {
  const sweep = () =>
    sweepExpiredTokens().catch((error: unknown) => {
      logger().warn({err: error}, 'Failed to sweep expired used-token rows');
    });
  void sweep();
  const timer = setInterval(() => void sweep(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
