import type {InlineLogRead, LogRecord, LogSource, LogState, PresignedLogRead} from './log-model.js';

export const STEP_LOG_DRAIN_REFETCH_MS = 250;
export const STEP_LOG_LIVE_REFETCH_MS = 2_000;

export interface StepLogSnapshot {
  records: LogRecord[];
  nextCursor: number;
  source: LogSource;
  state: LogState;
  complete: boolean;
  hasMore: boolean;
  truncated: boolean;
  totalBytes: number | null;
  expiresAt: string | null;
}

export type ResolvedStepLogRead =
  | {mode: 'inline'; response: InlineLogRead; records: readonly LogRecord[]}
  | {mode: 'presigned'; response: PresignedLogRead; records: readonly LogRecord[]};

export function mergeLogRead(
  previous: StepLogSnapshot | undefined,
  read: ResolvedStepLogRead,
): StepLogSnapshot {
  if (read.mode === 'presigned') {
    return {
      records: [...read.records],
      nextCursor: 0,
      source: 'presigned',
      state: 'compacted',
      complete: true,
      hasMore: false,
      truncated: read.response.truncated,
      totalBytes: read.response.totalBytes,
      expiresAt: read.response.expiresAt,
    };
  }

  const complete = read.response.state === 'closed' && !read.response.hasMore;

  return {
    records: [...(previous?.records ?? []), ...read.records],
    nextCursor: read.response.nextCursor,
    source: 'inline',
    state: read.response.state,
    complete,
    hasMore: read.response.hasMore,
    truncated: read.response.truncated,
    totalBytes: null,
    expiresAt: null,
  };
}

export function stepLogRefetchInterval(
  snapshot: StepLogSnapshot | undefined,
  lastFetchErrored = false,
): number | false {
  // A persistent failure (deleted step, 5xx, an unparseable record line) never advances
  // the cursor, so without this guard the interval re-polls the same dead cursor forever.
  // Stop once a fetch errors out (React Query's own retry absorbs transient blips first);
  // refetchOnWindowFocus/Reconnect (gated on !complete) resume it.
  if (lastFetchErrored) return false;
  if (!snapshot || snapshot.complete) return false;
  return snapshot.hasMore ? STEP_LOG_DRAIN_REFETCH_MS : STEP_LOG_LIVE_REFETCH_MS;
}
