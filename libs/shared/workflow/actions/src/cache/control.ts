import {CacheHttpError, CacheProtocolError} from '#cache/errors.js';
import {
  CONTROL_RETRY_DELAYS_MS,
  isRetryableFailure,
  type Sleeper,
  withRetries,
} from '#cache/retry.js';
import {
  CACHE_ABORT_PATH,
  CACHE_CHECK_PATH,
  CACHE_COMMIT_PATH,
  CACHE_RESERVE_PATH,
  CACHE_RESTORE_PATH,
  type CacheCheckRequestV1,
  type CacheCheckResponseV1,
  type CacheCommitRequestV1,
  type CacheReserveRequestV1,
  type CacheReserveResponseV1,
  type CacheRestoreRequestV1,
  type CacheRestoreResponseV1,
} from '#contract.js';

const TRAILING_SLASHES_RE = /\/+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

/** The calls to the local endpoint, which forwards them to the API with the lease token. */
export interface CacheControl {
  restore(request: CacheRestoreRequestV1, signal?: AbortSignal): Promise<CacheRestoreResponseV1>;
  reserve(request: CacheReserveRequestV1, signal?: AbortSignal): Promise<CacheReserveResponseV1>;
  commit(request: CacheCommitRequestV1, signal?: AbortSignal): Promise<void>;
  /** One attempt, and it never throws: it runs while a failure is being handled. */
  abort(entryId: string): Promise<void>;
  check(request: CacheCheckRequestV1, signal?: AbortSignal): Promise<CacheCheckResponseV1>;
}

export interface CacheControlOptions {
  url: string;
  token: string;
  fetch: typeof fetch;
  sleeper: Sleeper;
  delaysMs?: readonly number[];
}

/** Abort runs while a failure is handled, so it gets a short deadline. The reaper catches a miss. */
const ABORT_TIMEOUT_MS = 15_000;

export function createCacheControl(options: CacheControlOptions): CacheControl {
  const baseUrl = options.url.replace(TRAILING_SLASHES_RE, '');
  const delaysMs = options.delaysMs ?? CONTROL_RETRY_DELAYS_MS;

  const post = async <T>(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    isValid: (value: unknown) => value is T,
  ): Promise<T> => {
    const answer = await withRetries({
      delaysMs,
      signal,
      sleeper: options.sleeper,
      isRetryable: isRetryableFailure,
      run: () => send({options, baseUrl, path, body, signal}),
    });
    if (!isValid(answer)) {
      throw new CacheProtocolError(`The cache endpoint answered ${path} with an unexpected body.`);
    }
    return answer;
  };

  return {
    restore: (request, signal) => post(CACHE_RESTORE_PATH, request, signal, isRestoreResponse),
    reserve: (request, signal) => post(CACHE_RESERVE_PATH, request, signal, isReserveResponse),
    check: (request, signal) => post(CACHE_CHECK_PATH, request, signal, isCheckResponse),
    async commit(request, signal) {
      await post(CACHE_COMMIT_PATH, request, signal, isCommitResponse);
    },
    async abort(entryId) {
      try {
        await send({
          options,
          baseUrl,
          path: CACHE_ABORT_PATH,
          body: {entry_id: entryId},
          signal: AbortSignal.timeout(ABORT_TIMEOUT_MS),
        });
      } catch {
        // The reaper removes an upload nobody finished.
      }
    },
  };
}

async function send(params: {
  options: CacheControlOptions;
  baseUrl: string;
  path: string;
  body: unknown;
  signal: AbortSignal | undefined;
}): Promise<unknown> {
  const response = await params.options.fetch(`${params.baseUrl}${params.path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.options.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(params.body),
    ...(params.signal ? {signal: params.signal} : {}),
  });
  const text = await response.text();
  const parsed = parseJson(text);
  if (!response.ok) {
    const error = isRecord(parsed) ? parsed : {};
    throw new CacheHttpError({
      status: response.status,
      code: typeof error.code === 'string' ? error.code : undefined,
      message:
        typeof error.message === 'string'
          ? error.message
          : `The cache endpoint answered ${params.path} with HTTP ${response.status}.`,
    });
  }
  return parsed;
}

function parseJson(text: string): unknown {
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRestoreResponse(value: unknown): value is CacheRestoreResponseV1 {
  if (!isRecord(value) || !('hit' in value)) return false;
  const {hit} = value;
  if (hit === null) return true;
  return (
    isRecord(hit) &&
    typeof hit.entry_id === 'string' &&
    typeof hit.scope === 'string' &&
    typeof hit.key === 'string' &&
    typeof hit.exact === 'boolean' &&
    typeof hit.url === 'string' &&
    typeof hit.sha256 === 'string' &&
    SHA256_RE.test(hit.sha256) &&
    Number.isSafeInteger(hit.size_bytes) &&
    (hit.size_bytes as number) > 0
  );
}

function isReserveResponse(value: unknown): value is CacheReserveResponseV1 {
  if (!isRecord(value)) return false;
  if (value.status === 'reserved') {
    return (
      typeof value.entry_id === 'string' &&
      Number.isSafeInteger(value.part_size) &&
      (value.part_size as number) > 0 &&
      Array.isArray(value.part_urls) &&
      value.part_urls.length > 0 &&
      value.part_urls.every((url) => typeof url === 'string')
    );
  }
  return (
    value.status === 'exists' || value.status === 'in_progress' || value.status === 'too_large'
  );
}

function isCheckResponse(value: unknown): value is CacheCheckResponseV1 {
  return isRecord(value) && typeof value.exists === 'boolean';
}

function isCommitResponse(value: unknown): value is {status: 'ready'} {
  return isRecord(value) && value.status === 'ready';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
