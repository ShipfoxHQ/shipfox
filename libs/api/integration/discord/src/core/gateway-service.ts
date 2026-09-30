import {setTimeout as sleep} from 'node:timers/promises';
import {reportError} from '@shipfox/node-error-monitoring';
import type {ModuleService} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {openPostgresSession, type Client as PostgresClient} from '@shipfox/node-postgres';

export const GATEWAY_LOCK_KEY = 'integrations:discord:gateway:0';

const ACQUIRE_RETRY_MS = 10_000;
const LIVENESS_INTERVAL_MS = 15_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 5_000;

export type GatewayLostReason = 'lost' | 'shutdown';

export interface DiscordGatewayServiceOptions {
  /** Runs once this replica holds the shard lock. Errors are reported and do not end the lease. */
  onLeading?: () => Promise<void> | void;
  /**
   * Runs when the lease ends, before the lock is released on shutdown. Stop dispatches, write the
   * committed cursor, and close the socket with a resumable code here.
   */
  onLost?: (reason: GatewayLostReason) => Promise<void> | void;
  acquireRetryMs?: number;
  livenessIntervalMs?: number;
  openSession?: () => Promise<PostgresClient>;
}

export function createDiscordGatewayService(
  options: DiscordGatewayServiceOptions = {},
): ModuleService {
  return {
    name: 'discord-gateway',
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    start: () => {
      const abortController = new AbortController();
      const finished = runLeaderLoop(options, abortController.signal);
      return Promise.resolve({
        stop: async () => {
          abortController.abort();
          await finished;
        },
        finished,
      });
    },
  };
}

async function runLeaderLoop(
  options: DiscordGatewayServiceOptions,
  signal: AbortSignal,
): Promise<void> {
  const retryMs = options.acquireRetryMs ?? ACQUIRE_RETRY_MS;

  while (!signal.aborted) {
    let client: PostgresClient | undefined;
    try {
      client = await (options.openSession ?? openPostgresSession)();
      const connectionEnded = watchConnection(client);
      const acquired = await tryAcquireLock(client);
      if (acquired) {
        await lead({client, connectionEnded, options, signal});
        continue;
      }
    } catch (error) {
      if (signal.aborted) break;
      logger().error({err: error}, 'Discord Gateway leader election failed');
      reportError(error, {boundary: 'discord.gateway.election'});
    } finally {
      if (client) await closeQuietly(client);
    }
    await wait(retryMs, signal);
  }
}

interface LeadParams {
  client: PostgresClient;
  connectionEnded: Promise<void>;
  options: DiscordGatewayServiceOptions;
  signal: AbortSignal;
}

async function lead(params: LeadParams): Promise<void> {
  const {client, connectionEnded, options, signal} = params;
  logger().info('Discord Gateway leadership acquired');
  await runCallback(() => options.onLeading?.(), 'discord.gateway.leading');

  const reason = await holdLease({client, connectionEnded, signal, options});
  logger().info({reason}, 'Discord Gateway leadership ended');
  await runCallback(() => options.onLost?.(reason), 'discord.gateway.lost');
  if (reason === 'shutdown') await unlockQuietly(client);
}

async function holdLease(params: {
  client: PostgresClient;
  connectionEnded: Promise<void>;
  signal: AbortSignal;
  options: DiscordGatewayServiceOptions;
}): Promise<GatewayLostReason> {
  const {client, connectionEnded, signal, options} = params;
  const intervalMs = options.livenessIntervalMs ?? LIVENESS_INTERVAL_MS;

  while (!signal.aborted) {
    const outcome = await Promise.race([
      wait(intervalMs, signal).then(() => 'tick' as const),
      connectionEnded.then(() => 'lost' as const),
    ]);
    if (outcome === 'lost') return 'lost';
    if (signal.aborted) break;
    try {
      await withDeadline(client.query('SELECT 1'), intervalMs);
    } catch {
      return 'lost';
    }
  }
  return 'shutdown';
}

async function tryAcquireLock(client: PostgresClient): Promise<boolean> {
  const result = await client.query<{acquired: boolean}>(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
    [GATEWAY_LOCK_KEY],
  );
  return result.rows[0]?.acquired === true;
}

/** Resolves when the connection drops. Without an `error` listener a dropped client would crash the process. */
function watchConnection(client: PostgresClient): Promise<void> {
  return new Promise((resolve) => {
    client.on('error', (error) => {
      logger().warn({err: error}, 'Discord Gateway lock connection failed');
      resolve();
    });
    client.on('end', resolve);
  });
}

async function runCallback(fn: () => Promise<void> | void, boundary: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    logger().error({err: error}, 'Discord Gateway callback failed');
    reportError(error, {boundary});
  }
}

async function unlockQuietly(client: PostgresClient): Promise<void> {
  try {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [GATEWAY_LOCK_KEY]);
  } catch {
    // Closing the connection releases the lock anyway.
  }
}

async function closeQuietly(client: PostgresClient): Promise<void> {
  try {
    await withDeadline(client.end(), CLOSE_TIMEOUT_MS);
  } catch {
    // The connection is already gone, or a half-open socket never answered.
  }
}

/** A half-open connection never answers, so a probe or close without a deadline can hang forever. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await sleep(ms, undefined, {signal});
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
}
