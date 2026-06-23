import {type LogRecord, parseLogRecordLine, type ReadLogsResponseDto} from '@shipfox/api-logs-dto';

export const STEP_LOG_DRAIN_REFETCH_MS = 250;
export const STEP_LOG_LIVE_REFETCH_MS = 2_000;

const NDJSON_LINE_BREAK = /\r?\n/;

type InlineReadLogsResponse = Extract<ReadLogsResponseDto, {mode: 'inline'}>;
type PresignedReadLogsResponse = Extract<ReadLogsResponseDto, {mode: 'presigned'}>;

export interface StepLogSnapshot {
  records: LogRecord[];
  nextCursor: number;
  source: 'inline' | 'presigned';
  state: 'open' | 'closed' | 'compacted';
  complete: boolean;
  hasMore: boolean;
  truncated: boolean;
  totalBytes: number | null;
  expiresAt: string | null;
}

export type ResolvedStepLogRead =
  | {mode: 'inline'; response: InlineReadLogsResponse}
  | {mode: 'presigned'; response: PresignedReadLogsResponse; ndjson: string};

export function parseLogNdjson(ndjson: string): LogRecord[] {
  return ndjson
    .split(NDJSON_LINE_BREAK)
    .filter((line) => line.length > 0)
    .map(parseLogRecordLine);
}

export function mergeLogRead(
  previous: StepLogSnapshot | undefined,
  read: ResolvedStepLogRead,
): StepLogSnapshot {
  if (read.mode === 'presigned') {
    return {
      records: parseLogNdjson(read.ndjson),
      nextCursor: 0,
      source: 'presigned',
      state: 'compacted',
      complete: true,
      hasMore: false,
      truncated: read.response.truncated,
      totalBytes: read.response.total_bytes,
      expiresAt: read.response.expires_at,
    };
  }

  const records = parseLogNdjson(read.response.ndjson);
  const complete = read.response.state === 'closed' && !read.response.has_more;

  return {
    records: [...(previous?.records ?? []), ...records],
    nextCursor: read.response.next_cursor,
    source: 'inline',
    state: read.response.state,
    complete,
    hasMore: read.response.has_more,
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
