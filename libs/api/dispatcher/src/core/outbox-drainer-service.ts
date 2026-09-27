import {setTimeout as sleep} from 'node:timers/promises';
import {reportError} from '@shipfox/node-error-monitoring';
import type {ModuleService} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';
import {onOutboxWrite} from '@shipfox/node-outbox';
import {type DrainCycleResult, runDrainCycle} from '#core/run-drain-cycle.js';

const ERROR_BACKOFF_MS = 1_000;
const IDLE_BACKOFF_MAX_MS = 2_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

interface OutboxDrainerServiceOptions {
  readonly pollMs: number;
  readonly runDrainCycle?: (signal: AbortSignal) => Promise<DrainCycleResult>;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly onWrite?: (listener: () => void) => () => void;
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
      const wakeup = createWakeup();
      const unsubscribe = (options.onWrite ?? onOutboxWrite)(wakeup.notify);
      const finished = runOutboxDrainer({
        drain,
        wait,
        wakeup,
        reportDrainError,
        pollMs: options.pollMs,
        signal: abortController.signal,
      });

      return Promise.resolve({
        stop: async () => {
          unsubscribe();
          abortController.abort();
          await finished;
        },
        finished,
      });
    },
  };
}

interface RunOutboxDrainerOptions {
  readonly drain: (signal: AbortSignal) => Promise<DrainCycleResult>;
  readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly wakeup: Wakeup;
  readonly reportDrainError: (error: unknown) => void;
  readonly pollMs: number;
  readonly signal: AbortSignal;
}

async function runOutboxDrainer(options: RunOutboxDrainerOptions): Promise<void> {
  const maxIdleMs = Math.max(options.pollMs, IDLE_BACKOFF_MAX_MS);
  let idleMs = options.pollMs;

  while (!options.signal.aborted) {
    try {
      const {claimed, hasMore} = await options.drain(options.signal);
      if (hasMore) continue;

      idleMs =
        claimed > 0 || options.wakeup.take() ? options.pollMs : Math.min(idleMs * 2, maxIdleMs);
      await options.wakeup.sleep(idleMs, options.signal, options.wait);
      if (options.wakeup.take()) {
        // The writer's transaction may still be open, so give it one poll interval to commit.
        idleMs = options.pollMs;
        await options.wait(options.pollMs, options.signal);
      }
    } catch (error) {
      if (options.signal.aborted) return;
      options.reportDrainError(error);
      await options.wait(ERROR_BACKOFF_MS, options.signal);
    }
  }
}

interface Wakeup {
  readonly notify: () => void;
  readonly take: () => boolean;
  readonly sleep: (
    ms: number,
    signal: AbortSignal,
    wait: (ms: number, signal: AbortSignal) => Promise<void>,
  ) => Promise<void>;
}

function createWakeup(): Wakeup {
  let pending = false;
  let interrupt: AbortController | undefined;

  return {
    notify: () => {
      pending = true;
      interrupt?.abort();
    },
    take: () => {
      const wasPending = pending;
      pending = false;
      return wasPending;
    },
    sleep: async (ms, signal, wait) => {
      if (pending) return;
      interrupt = new AbortController();
      try {
        await wait(ms, AbortSignal.any([signal, interrupt.signal]));
      } finally {
        interrupt = undefined;
      }
    },
  };
}

async function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await sleep(ms, undefined, {signal});
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
}
