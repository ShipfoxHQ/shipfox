import {setTimeout as sleep} from 'node:timers/promises';
import type {IIdentifyThrottler} from '@discordjs/ws';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {DiscordGatewayBot} from '#api/client.js';
import {gatewayBackoffMs} from './gateway-backoff.js';

export const GATEWAY_ERROR_BOUNDARY = 'integrations.discord.gateway';

/** Discord allows one Identify per 5 s at `max_concurrency` 1. */
export const IDENTIFY_SPACING_MS = 5_000;
/** Hitting the daily Identify limit resets the bot token, so stop well before it. */
export const IDENTIFY_MIN_REMAINING = 100;

export interface IdentifyGuardOptions {
  getGatewayBot: () => Promise<DiscordGatewayBot>;
  spacingMs?: number;
  minRemaining?: number;
  /** Delay before retrying a failed budget check. Defaults to the Gateway backoff. */
  backoffMs?: (attempt: number) => number;
}

/**
 * The manager's Identify throttler, so it covers the library's own Identify after an Invalid
 * Session too. It waits and never throws while the signal is live: the library retries a throw
 * after 500 ms. An abort rejects, which the library treats as a closed shard.
 */
export function createIdentifyGuard(options: IdentifyGuardOptions): IIdentifyThrottler {
  const spacingMs = options.spacingMs ?? IDENTIFY_SPACING_MS;
  const minRemaining = options.minRemaining ?? IDENTIFY_MIN_REMAINING;
  let lastIdentifyAt = 0;
  let reportedShards = false;
  let queue: Promise<unknown> = Promise.resolve();

  async function waitForIdentify(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (true) {
      signal.throwIfAborted();
      const spacingLeftMs = lastIdentifyAt + spacingMs - Date.now();
      if (spacingLeftMs > 0) await sleep(spacingLeftMs, undefined, {signal});

      const bot = await fetchGatewayBot();
      signal.throwIfAborted();
      if (!bot) {
        const retryMs = options.backoffMs?.(failures) ?? gatewayBackoffMs({attempt: failures});
        failures++;
        await sleep(retryMs, undefined, {signal});
        continue;
      }
      failures = 0;

      const refusedForMs = assessBudget(bot);
      if (refusedForMs !== undefined) {
        await sleep(refusedForMs, undefined, {signal});
        continue;
      }
      lastIdentifyAt = Date.now();
      return;
    }
  }

  /** Reports what needs attention and returns how long to wait when the budget refuses. */
  function assessBudget(bot: DiscordGatewayBot): number | undefined {
    if (bot.shards > 1 && !reportedShards) {
      reportedShards = true;
      reportError(new Error(`Discord recommends ${bot.shards} shards, connecting with one`), {
        boundary: GATEWAY_ERROR_BOUNDARY,
      });
    }
    const {remaining, reset_after: resetAfterMs} = bot.session_start_limit;
    if (remaining >= minRemaining) return undefined;
    reportError(new Error(`Identify refused: ${remaining} session starts remaining`), {
      boundary: GATEWAY_ERROR_BOUNDARY,
    });
    return Math.max(resetAfterMs, spacingMs);
  }

  async function fetchGatewayBot(): Promise<DiscordGatewayBot | undefined> {
    try {
      return await options.getGatewayBot();
    } catch (error) {
      logger().warn({err: error}, 'Discord Gateway Identify budget check failed');
      return undefined;
    }
  }

  return {
    waitForIdentify(_shardId, signal) {
      const run = queue.then(() => waitForIdentify(signal));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
