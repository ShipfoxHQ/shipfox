import {setTimeout as setTimeoutPromise} from 'node:timers/promises';

export interface BackoffOptions {
  readonly maxMs: number;
  readonly factor?: number;
}

export interface JitterOptions {
  readonly minFactor?: number;
  readonly maxFactor?: number;
  readonly random?: () => number;
}

export interface GracefulShutdownControllerOptions {
  readonly signals?: readonly NodeJS.Signals[];
  readonly onFirstSignal?: (signal: NodeJS.Signals) => void;
  readonly onSecondSignal?: (signal: NodeJS.Signals) => void;
}

export interface GracefulShutdownController {
  readonly signal: AbortSignal;
  start: () => void;
  stop: () => void;
  reset: () => void;
  isShuttingDown: () => boolean;
}

export function nextBackoffInterval(currentMs: number, options: BackoffOptions): number {
  return Math.min(currentMs * (options.factor ?? 1.5), options.maxMs);
}

export function withJitter(ms: number, options: JitterOptions = {}): number {
  const minFactor = options.minFactor ?? 0;
  const maxFactor = options.maxFactor ?? 1;
  const random = options.random ?? Math.random;

  return ms * (minFactor + random() * (maxFactor - minFactor));
}

export async function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  try {
    await setTimeoutPromise(ms, undefined, {signal});
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
}

export function createGracefulShutdownController(
  options: GracefulShutdownControllerOptions = {},
): GracefulShutdownController {
  const signals = options.signals ?? (['SIGINT', 'SIGTERM'] satisfies NodeJS.Signals[]);
  let started = false;
  let shuttingDown = false;
  let abortController = new AbortController();

  const handleSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      options.onSecondSignal?.(signal);
      return;
    }

    shuttingDown = true;
    abortController.abort(signal);
    options.onFirstSignal?.(signal);
  };

  return {
    get signal() {
      return abortController.signal;
    },
    start: () => {
      if (started) return;

      for (const signal of signals) {
        process.on(signal, handleSignal);
      }
      started = true;
    },
    stop: () => {
      if (!started) return;

      for (const signal of signals) {
        process.removeListener(signal, handleSignal);
      }
      started = false;
    },
    reset: () => {
      shuttingDown = false;
      if (abortController.signal.aborted) abortController = new AbortController();
    },
    isShuttingDown: () => shuttingDown,
  };
}
