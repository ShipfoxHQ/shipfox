import ky, {type Options as KyOptions} from 'ky';
import {parseServerSentEvents} from './server-sent-events.js';

export {apiConfigShape} from './config.js';

export interface ApiClientOptions {
  baseUrl?: string | undefined;
  getAccessToken?: (() => string | undefined) | undefined;
  prepareAccessToken?:
    | ((input: {
        accessToken: string | undefined;
        signal: AbortSignal | undefined;
      }) => Promise<string | undefined>)
    | undefined;
  refreshAccessToken?:
    | ((input?: {
        accessToken: string | undefined;
        signal: AbortSignal | undefined;
      }) => Promise<string | undefined> | string | undefined)
    | undefined;
  /**
   * Optional credential supplier used only for the single retry after an
   * authenticated 401. It is separate from prepareAccessToken so an adopted
   * session can renew only after the transport has observed that the bearer
   * was rejected.
   */
  retryAccessToken?:
    | ((input: {
        accessToken: string | undefined;
        signal: AbortSignal | undefined;
      }) => Promise<string | undefined> | string | undefined)
    | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export type ApiRequestAuthentication = 'cookie-only';

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal | undefined;
  authentication?: ApiRequestAuthentication | undefined;
}

export interface StandardSchema<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | {readonly value: Output; readonly issues?: undefined}
      | {readonly value?: undefined; readonly issues: ReadonlyArray<unknown>}
      | Promise<
          | {readonly value: Output; readonly issues?: undefined}
          | {readonly value?: undefined; readonly issues: ReadonlyArray<unknown>}
        >;
  };
}

export type StandardSchemaOutput<Schema extends StandardSchema> =
  Schema extends StandardSchema<unknown, infer Output> ? Output : never;

/** Pass to `checkedApiRequest` for endpoints (e.g. DELETE) with no response body. */
export const emptyResponseSchema: StandardSchema<unknown, undefined> = {
  '~standard': {version: 1, vendor: 'client-api', validate: () => ({value: undefined})},
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(params: {message: string; code: string; status: number; details?: unknown}) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }
}

export const ADOPTED_SESSION_PAUSED_CODE = 'adopted-session-paused';
export const ADOPTED_SESSION_ENDED_CODE = 'adopted-session-ended';

export const ADOPTED_SESSION_RELEASE_REASONS = Object.freeze([
  'manual-stop',
  'hard-deadline',
  'continuation-terminal',
  'adopted-unauthorized',
  'replaced',
  'logout',
] as const);

export type AdoptedSessionReleaseReason = (typeof ADOPTED_SESSION_RELEASE_REASONS)[number];

export function isAdoptedSessionReleaseReason(
  value: unknown,
): value is AdoptedSessionReleaseReason {
  return (
    typeof value === 'string' &&
    (ADOPTED_SESSION_RELEASE_REASONS as readonly string[]).includes(value)
  );
}

/** Creates the safe request-gate error used while adopted renewal is paused. */
export function createAdoptedSessionPausedError(): ApiError {
  return new ApiError({
    message: 'Adopted session renewal is paused.',
    code: ADOPTED_SESSION_PAUSED_CODE,
    status: 0,
  });
}

/** Creates the safe request-gate error used after an adopted session ends. */
export function createAdoptedSessionEndedError(reason: unknown): ApiError {
  return new ApiError({
    message: 'The adopted session has ended.',
    code: ADOPTED_SESSION_ENDED_CODE,
    status: 0,
    details: isAdoptedSessionReleaseReason(reason) ? {reason} : undefined,
  });
}

export class InvalidApiResponseError extends Error {
  readonly code = 'invalid-response';

  constructor() {
    super('The server returned an invalid response.');
    this.name = 'InvalidApiResponseError';
  }
}

let apiOptions: ApiClientOptions = {};
const TRAILING_SLASH_RE = /\/$/;
const LEADING_SLASH_RE = /^\//;
const AUTH_REFRESH_PATH_RE = /\/auth\/refresh\/?$/;

// The base URL is supplied by the caller (the app resolves it from the
// validated runtime config and passes it to configureApiClient). Empty means
// same-origin relative requests.
function defaultBaseUrl(): string {
  return apiOptions.baseUrl ?? '';
}

export function configureApiClient(options: ApiClientOptions): void {
  apiOptions = {...apiOptions, ...options};
}

/**
 * Clears all client configuration set by {@link configureApiClient}, restoring
 * same-origin defaults with no auth or fetch overrides. Tests call this between
 * files so a `configureApiClient` in one suite cannot leak its wiring into the
 * next when the runner shares module state across files (`isolate: false`).
 */
export function resetApiClient(): void {
  apiOptions = {};
}

export function getErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function isErrorWithCode(error: unknown, code: string): boolean {
  return getErrorCode(error) === code;
}

export function isInvalidApiResponseError(error: unknown): error is InvalidApiResponseError {
  return error instanceof InvalidApiResponseError;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(TRAILING_SLASH_RE, '')}/${path.replace(LEADING_SLASH_RE, '')}`;
}

/** Resolves a path against the configured API base. Same-origin URLs remain relative. */
export function resolveApiUrl(path: string): string {
  return joinUrl(defaultBaseUrl(), path);
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

function toApiError(response: Response, parsed: unknown): ApiError {
  const payload = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const record = payload as {message?: unknown; code?: unknown};
  return new ApiError({
    message: typeof record.message === 'string' ? record.message : response.statusText,
    code: typeof record.code === 'string' ? record.code : 'request-failed',
    status: response.status,
    details: parsed,
  });
}

async function sendApiRequest<T>(url: string, requestInit: KyOptions): Promise<T> {
  let response: Response;
  try {
    response = await ky(url, requestInit);
  } catch (error) {
    throw new ApiError({
      message: error instanceof Error ? error.message : 'Network request failed',
      code: 'network-error',
      status: 0,
      details: {url, error},
    });
  }

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    throw toApiError(response, parsed);
  }

  return parsed as T;
}

function isAdoptedSessionGateError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === ADOPTED_SESSION_PAUSED_CODE || error.code === ADOPTED_SESSION_ENDED_CODE)
  );
}

function shouldRefreshAccessToken(params: {
  error: ApiError;
  path: string;
  usedConfiguredAccessToken: boolean;
}): boolean {
  return (
    params.error.status === 401 &&
    params.error.code === 'unauthorized' &&
    params.usedConfiguredAccessToken &&
    !AUTH_REFRESH_PATH_RE.test(params.path)
  );
}

async function prepareConfiguredAccessToken(
  options: ApiRequestOptions,
  hasCallerAuthorization: boolean,
): Promise<{accessToken: string | undefined; usedConfiguredAccessToken: boolean}> {
  if (options.authentication === 'cookie-only') {
    return {accessToken: undefined, usedConfiguredAccessToken: false};
  }

  const accessToken = apiOptions.getAccessToken?.();
  if (hasCallerAuthorization) {
    return {accessToken: undefined, usedConfiguredAccessToken: false};
  }

  const preparedAccessToken = apiOptions.prepareAccessToken
    ? await apiOptions.prepareAccessToken({accessToken, signal: options.signal})
    : accessToken;

  return {
    accessToken: preparedAccessToken,
    usedConfiguredAccessToken: Boolean(preparedAccessToken),
  };
}

async function retryAccessToken(
  accessToken: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  if (apiOptions.retryAccessToken) {
    return await apiOptions.retryAccessToken({accessToken, signal});
  }
  if (apiOptions.prepareAccessToken) {
    return await apiOptions.prepareAccessToken({accessToken, signal});
  }
  return await apiOptions.refreshAccessToken?.({accessToken, signal});
}

async function getRetryAccessTokenOrThrowOriginal(
  accessToken: string | undefined,
  signal: AbortSignal | undefined,
  originalError: ApiError,
): Promise<string | undefined> {
  try {
    return await retryAccessToken(accessToken, signal);
  } catch (retryError) {
    if (isAdoptedSessionGateError(retryError) || signal?.aborted) throw retryError;
    throw originalError;
  }
}

function createRequestInit(options: ApiRequestOptions, headers: Headers): KyOptions {
  const requestInit: KyOptions = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    fetch: apiOptions.fetchImpl ?? defaultFetch,
    retry: 0,
    throwHttpErrors: false,
    timeout: false,
  };

  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  if (options.body !== undefined) {
    requestInit.body = JSON.stringify(options.body);
  }
  if (options.signal) {
    requestInit.signal = options.signal;
  }

  return requestInit;
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const hasCallerAuthorization = headers.has('authorization');
  if (options.authentication === 'cookie-only' && hasCallerAuthorization) {
    throw new ApiError({
      message: 'Cookie-only requests cannot include an authorization header.',
      code: 'invalid-request',
      status: 0,
    });
  }

  const {accessToken, usedConfiguredAccessToken} = await prepareConfiguredAccessToken(
    options,
    hasCallerAuthorization,
  );
  const baseUrl = defaultBaseUrl();
  const url = joinUrl(baseUrl, path);
  const requestInit = createRequestInit(options, headers);

  if (accessToken && !hasCallerAuthorization) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  try {
    return await sendApiRequest<T>(url, requestInit);
  } catch (error) {
    if (
      error instanceof ApiError &&
      shouldRefreshAccessToken({error, path, usedConfiguredAccessToken})
    ) {
      const refreshedToken = await getRetryAccessTokenOrThrowOriginal(
        accessToken,
        options.signal,
        error,
      );
      if (refreshedToken) {
        headers.set('authorization', `Bearer ${refreshedToken}`);
        return await sendApiRequest<T>(url, requestInit);
      }
    }
    throw error;
  }
}

/**
 * Requests and validates a JSON response at the transport boundary.
 *
 * Invalid payloads intentionally expose no response body or validation details,
 * which can contain unexpected sensitive values from an untrusted server.
 */
export async function checkedApiRequest<Schema extends StandardSchema>(
  schema: Schema,
  path: string,
  options: ApiRequestOptions = {},
): Promise<StandardSchemaOutput<Schema>> {
  const response = await apiRequest<unknown>(path, options);
  const result = await schema['~standard'].validate(response);
  if (result.issues) throw new InvalidApiResponseError();
  return result.value as StandardSchemaOutput<Schema>;
}

export interface ApiEventStreamOptions {
  headers?: HeadersInit;
  signal?: AbortSignal | undefined;
}

async function fetchEventStream(
  url: string,
  headers: Headers,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const fetchImpl = apiOptions.fetchImpl ?? defaultFetch;
  try {
    return await fetchImpl(url, {
      method: 'GET',
      credentials: 'include',
      headers,
      ...(signal ? {signal} : {}),
    });
  } catch (error) {
    // A caller that aborts expects the abort, not a failed request.
    if (signal?.aborted) throw error;
    throw new ApiError({
      message: error instanceof Error ? error.message : 'Network request failed',
      code: 'network-error',
      status: 0,
      details: {url, error},
    });
  }
}

async function openEventStream(
  path: string,
  options: ApiEventStreamOptions,
): Promise<ReadableStream<Uint8Array>> {
  const headers = new Headers(options.headers);
  headers.set('accept', 'text/event-stream');
  const hasCallerAuthorization = headers.has('authorization');
  const {accessToken, usedConfiguredAccessToken} = await prepareConfiguredAccessToken(
    {signal: options.signal},
    hasCallerAuthorization,
  );
  if (accessToken && !hasCallerAuthorization) headers.set('authorization', `Bearer ${accessToken}`);

  const url = joinUrl(defaultBaseUrl(), path);
  let response = await fetchEventStream(url, headers, options.signal);
  if (response.status === 401 && usedConfiguredAccessToken) {
    const rejected = toApiError(response, await parseResponseBody(response));
    if (!shouldRefreshAccessToken({error: rejected, path, usedConfiguredAccessToken})) {
      throw rejected;
    }
    const refreshedToken = await getRetryAccessTokenOrThrowOriginal(
      accessToken,
      options.signal,
      rejected,
    );
    if (!refreshedToken) throw rejected;
    headers.set('authorization', `Bearer ${refreshedToken}`);
    response = await fetchEventStream(url, headers, options.signal);
  }

  if (!response.ok) throw toApiError(response, await parseResponseBody(response));
  if (!response.body) {
    throw new ApiError({
      message: 'The server sent no stream.',
      code: 'network-error',
      status: response.status,
    });
  }
  return response.body;
}

/**
 * Opens a server-sent event stream with `fetch`, because `EventSource` cannot send the bearer
 * token, and validates each message at the transport boundary. The schema parses
 * `{event, data}`, with `data` already decoded from JSON.
 *
 * The generator ends when the server closes the stream. A connection that drops mid-stream
 * throws a `network-error` `ApiError`, so the caller decides whether to reconnect. Invalid
 * messages throw an `InvalidApiResponseError` that exposes none of their content.
 */
export async function* checkedApiEventStream<Schema extends StandardSchema>(
  schema: Schema,
  path: string,
  options: ApiEventStreamOptions = {},
): AsyncGenerator<StandardSchemaOutput<Schema>> {
  const body = await openEventStream(path, options);
  try {
    for await (const message of parseServerSentEvents(body)) {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        throw new InvalidApiResponseError();
      }
      const result = await schema['~standard'].validate({event: message.event, data});
      if (result.issues) throw new InvalidApiResponseError();
      yield result.value as StandardSchemaOutput<Schema>;
    }
  } catch (error) {
    if (error instanceof InvalidApiResponseError || options.signal?.aborted) throw error;
    throw new ApiError({
      message: error instanceof Error ? error.message : 'The stream was interrupted',
      code: 'network-error',
      status: 0,
      details: {path, error},
    });
  }
}
