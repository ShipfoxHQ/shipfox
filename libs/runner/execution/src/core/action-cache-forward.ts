import {
  CACHE_ABORT_PATH,
  CACHE_CHECK_PATH,
  CACHE_COMMIT_PATH,
  CACHE_RESERVE_PATH,
  CACHE_RESTORE_PATH,
  type CacheErrorResponseV1,
} from '@shipfox/actions/contract';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cache routes are small JSON. A commit lists at most 10000 parts. */
export const MAX_CACHE_REQUEST_BYTES = 4 * 1024 * 1024;
export const ACTION_CACHE_CALL_TIMEOUT_MS = 30_000;
// The API gives completing a multipart upload 60 s, so the runner waits longer than that.
export const ACTION_CACHE_COMMIT_TIMEOUT_MS = 90_000;

/** One call to the cache module of the API, made with the lease token. */
export interface ActionCacheRequest {
  method: 'POST' | 'DELETE';
  /** Relative to `/runs/jobs/current/cache`. */
  path: string;
  body?: unknown;
  signal: AbortSignal;
}

/** The API's own status and JSON body. A non-2xx answer is a value, not an exception. */
export interface ActionCacheResponse {
  status: number;
  body: unknown;
}

/** The cache module, reached with the runner's lease token. Without it, every call is a 503. */
export interface ActionCacheUpstream {
  request(request: ActionCacheRequest): Promise<ActionCacheResponse>;
}

export interface CacheForward {
  readonly request: Omit<ActionCacheRequest, 'signal'>;
  readonly timeoutMs: number;
}

const CACHE_PATHS: ReadonlySet<string> = new Set([
  CACHE_RESTORE_PATH,
  CACHE_RESERVE_PATH,
  CACHE_COMMIT_PATH,
  CACHE_ABORT_PATH,
  CACHE_CHECK_PATH,
]);

export function isCachePath(path: string): boolean {
  return CACHE_PATHS.has(path);
}

/** Maps a loopback route to the API route. The entry id moves from the body into the path. */
export function planCacheForward(path: string, body: unknown): CacheForward | CacheFailure {
  if (!isRecord(body)) return invalid('The request body must be a JSON object.');
  const timeoutMs = ACTION_CACHE_CALL_TIMEOUT_MS;
  switch (path) {
    case CACHE_RESTORE_PATH:
      return {request: {method: 'POST', path: 'restore', body}, timeoutMs};
    case CACHE_RESERVE_PATH:
      return {request: {method: 'POST', path: 'entries', body}, timeoutMs};
    case CACHE_CHECK_PATH:
      return {request: {method: 'POST', path: 'entries/check', body}, timeoutMs};
    case CACHE_COMMIT_PATH: {
      const entryId = entryIdOf(body);
      if (entryId === undefined) return invalid('The request needs an entry_id that is a UUID.');
      return {
        request: {method: 'POST', path: `entries/${entryId}/commit`, body: {parts: body.parts}},
        timeoutMs: ACTION_CACHE_COMMIT_TIMEOUT_MS,
      };
    }
    case CACHE_ABORT_PATH: {
      const entryId = entryIdOf(body);
      if (entryId === undefined) return invalid('The request needs an entry_id that is a UUID.');
      return {request: {method: 'DELETE', path: `entries/${entryId}`}, timeoutMs};
    }
    default:
      return invalid(`${path} is not a cache route.`);
  }
}

export interface CacheFailure {
  readonly status: number;
  readonly body: CacheErrorResponseV1;
}

export function cacheFailure(status: number, code: string, message: string): CacheFailure {
  return {status, body: {code, message}};
}

function invalid(message: string): CacheFailure {
  return cacheFailure(400, 'invalid-request', message);
}

function entryIdOf(body: Record<string, unknown>): string | undefined {
  return typeof body.entry_id === 'string' && UUID_RE.test(body.entry_id)
    ? body.entry_id
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Calls the cache module under the route's deadline. A failure to answer becomes a status the SDK
 * knows how to retry: 504 for the deadline, 503 for a cancelled step, 502 for anything else.
 */
export async function forwardCacheCall(params: {
  upstream: ActionCacheUpstream;
  plan: CacheForward;
  controller: AbortController;
}): Promise<ActionCacheResponse> {
  const {controller} = params;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('The cache call timed out.'));
  }, params.plan.timeoutMs);
  try {
    return await params.upstream.request({...params.plan.request, signal: controller.signal});
  } catch {
    if (timedOut) return cacheFailure(504, 'timeout', 'The cache call timed out.');
    if (controller.signal.aborted) {
      return cacheFailure(503, 'cancelled', 'The cache call was cancelled.');
    }
    return cacheFailure(502, 'upstream-unavailable', 'The cache could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}
