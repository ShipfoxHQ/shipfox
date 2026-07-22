import {setTimeout as sleep} from 'node:timers/promises';
import {reportError} from '@shipfox/node-error-monitoring';
import type {ModuleService} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {runDrainCycle} from '#core/run-drain-cycle.js';

const ERROR_BACKOFF_MS = 1_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

interface OutboxDrainerServiceOptions {
  readonly pollMs: number;
  readonly runDrainCycle?: (signal: AbortSignal) => Promise<boolean>;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly logError?: (error: unknown) => void;
}

export function createOutboxDrainerService(options: OutboxDrainerServiceOptions): ModuleService {
  const wait = options.sleep ?? interruptibleSleep;
  const reportDrainError =
    options.logError ??
    ((error) => {
      logger().error({err: error}, 'Outbox drain failed');
      reportError(error, {boundary: 'dispatcher.drain'});
    });

  return {
    name: 'outbox-drainer',
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    start: (context) => {
      const drain =
        options.runDrainCycle ??
        ((signal) => runDrainCycle(context.outboxRegistry, undefined, signal));
      const abortController = new AbortController();
      const finished = runOutboxDrainer({
        drain,
        wait,
        reportDrainError,
        pollMs: options.pollMs,
        signal: abortController.signal,
      });

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

interface RunOutboxDrainerOptions {
  readonly drain: (signal: AbortSignal) => Promise<boolean>;
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly reportDrainError: (error: unknown) => void;
  readonly pollMs: number;
  readonly signal: AbortSignal;
}

async function runOutboxDrainer(options: RunOutboxDrainerOptions): Promise<void> {
  while (!options.signal.aborted) {
    try {
      const hasMore = await options.drain(options.signal);
      if (!hasMore) await options.wait(options.pollMs, options.signal);
    } catch (error) {
      if (options.signal.aborted) return;
      options.reportDrainError(error);
      await options.wait(ERROR_BACKOFF_MS, options.signal);
    }
  }
}

async function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await sleep(ms, undefined, {signal});
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
}
