import {
  CacheHttpError,
  CacheLocalError,
  CacheObjectGoneError,
  CacheProtocolError,
  CacheStallError,
} from '#cache/errors.js';

export interface Sleeper {
  sleep(ms: number, signal: AbortSignal | undefined): Promise<void>;
}

export const systemSleeper: Sleeper = {
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, {once: true});
    }),
};

/** Waits before the second, third, and fourth attempt of a part or a range. */
export const TRANSFER_RETRY_DELAYS_MS: readonly number[] = [500, 2000, 8000];
/** Waits before the second and third attempt of a control call. */
export const CONTROL_RETRY_DELAYS_MS: readonly number[] = [500, 2000];

const JITTER_RATIO = 0.25;

/**
 * Runs `run` once, then again after each delay while the error is retryable. The jitter spreads
 * the retries of parts that failed together.
 */
export async function withRetries<T>(params: {
  delaysMs: readonly number[];
  signal: AbortSignal | undefined;
  sleeper: Sleeper;
  isRetryable: (error: unknown) => boolean;
  run: () => Promise<T>;
}): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await params.run();
    } catch (error) {
      const delay = params.delaysMs[attempt];
      if (delay === undefined || params.signal?.aborted || !params.isRetryable(error)) throw error;
      await params.sleeper.sleep(delay * (1 + Math.random() * JITTER_RATIO), params.signal);
    }
  }
}

/** Network failures, stalls, 408, 429, and 5xx. A 403 or 404 never gets better by waiting. */
export function isRetryableFailure(error: unknown): boolean {
  if (error instanceof CacheHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (
    error instanceof CacheLocalError ||
    error instanceof CacheProtocolError ||
    error instanceof CacheObjectGoneError
  ) {
    return false;
  }
  return true;
}

/** Fires `onStall` when `touch` has not been called for `stallMs`. */
export function createStallWatchdog(params: {
  stallMs: number;
  what: string;
  onStall: (error: CacheStallError) => void;
}) {
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    timer = setTimeout(
      () => params.onStall(new CacheStallError(params.what, params.stallMs)),
      params.stallMs,
    );
    timer.unref();
  };
  arm();
  return {
    touch() {
      clearTimeout(timer);
      arm();
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

/**
 * Runs `worker` for every item with at most `concurrency` at a time. The first failure aborts the
 * workers still running and is thrown once they have all settled.
 */
export async function runPool<T>(params: {
  items: readonly T[];
  concurrency: number;
  signal: AbortSignal | undefined;
  worker: (item: T, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort(params.signal?.reason);
  if (params.signal?.aborted) stop();
  else params.signal?.addEventListener('abort', stop, {once: true});

  let next = 0;
  let failure: {error: unknown} | undefined;
  const runner = async () => {
    while (!controller.signal.aborted) {
      const index = next++;
      if (index >= params.items.length) return;
      try {
        await params.worker(params.items[index] as T, controller.signal);
      } catch (error) {
        failure ??= {error};
        controller.abort(error);
        return;
      }
    }
  };
  try {
    await Promise.all(
      Array.from({length: Math.min(params.concurrency, params.items.length)}, runner),
    );
  } finally {
    params.signal?.removeEventListener('abort', stop);
  }
  if (failure) throw failure.error;
  params.signal?.throwIfAborted();
}
