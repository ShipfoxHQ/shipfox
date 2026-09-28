import {
  MAX_TOOL_REQUEST_BYTES,
  TOOLS_CALL_PATH,
  TOOLS_DOWNLOAD_PATH,
  type ToolCallSuccessResponseV1,
  type ToolDownloadSuccessResponseV1,
  type ToolErrorV1,
  type ToolFailureResponseV1,
} from '#contract.js';
import {ToolCallError} from '#tool-call-error.js';
import {ToolResult, toDownloadedFile} from '#tool-result.js';
import type {AliasTools, Tools} from '#tool-types.js';

export interface ToolsClientOptions {
  /** The local endpoint, `SHIPFOX_ACTIONS_URL`. */
  url: string;
  token: string;
  fetch?: typeof fetch;
  clock?: RetryClock;
}

export interface RetryClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal | undefined): Promise<void>;
}

export const MAX_RATE_LIMIT_RETRIES = 3;
export const RATE_LIMIT_RETRY_BUDGET_MS = 60_000;
const DEFAULT_RATE_LIMIT_DELAY_MS = 1000;
const TRAILING_SLASHES_RE = /\/+$/;

export function createToolsClient(options: ToolsClientOptions): Tools {
  const transport: Transport = {
    baseUrl: options.url.replace(TRAILING_SLASHES_RE, ''),
    token: options.token,
    fetch: options.fetch ?? fetch,
    clock: options.clock ?? systemClock,
  };
  const aliases = new Map<string, AliasTools>();

  return new Proxy({} as Tools, {
    get(_target, alias) {
      // Symbols and `then` are probes (inspection, `await tools`), not aliases.
      if (typeof alias !== 'string' || alias === 'then') return undefined;
      let tools = aliases.get(alias);
      if (!tools) {
        tools = createAliasTools(transport, alias);
        aliases.set(alias, tools);
      }
      return tools;
    },
  });
}

interface Transport {
  baseUrl: string;
  token: string;
  fetch: typeof fetch;
  clock: RetryClock;
}

function createAliasTools(transport: Transport, alias: string): AliasTools {
  return {
    async call(tool, args = {}, options = {}) {
      const response = await send<ToolCallSuccessResponseV1>(transport, {
        path: TOOLS_CALL_PATH,
        label: `${alias}.${tool}`,
        body: {alias, tool, arguments: args},
        signal: options.signal,
        isSuccess: isCallSuccess,
      });
      return new ToolResult(response.result);
    },
    async download(tool, args, options) {
      const response = await send<ToolDownloadSuccessResponseV1>(transport, {
        path: TOOLS_DOWNLOAD_PATH,
        label: `${alias}.${tool}`,
        body: {alias, tool, arguments: args, destination: options.destination},
        signal: options.signal,
        isSuccess: isDownloadSuccess,
      });
      return toDownloadedFile(response.file);
    },
  };
}

interface SendParams<T> {
  path: string;
  label: string;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
  isSuccess: (value: unknown) => value is T;
}

async function send<T>(transport: Transport, params: SendParams<T>): Promise<T> {
  const body = JSON.stringify(params.body);
  const bodyBytes = Buffer.byteLength(body, 'utf8');
  if (bodyBytes > MAX_TOOL_REQUEST_BYTES) {
    throw new ToolCallError({
      code: 'request-too-large',
      message: `${params.label}: the request is ${bodyBytes} bytes, above the ${MAX_TOOL_REQUEST_BYTES} byte limit.`,
      outcomeUnknown: false,
      callId: null,
    });
  }

  const startedAt = transport.clock.now();
  let retries = 0;
  while (true) {
    const response = await post(transport, params, body);
    if (!isFailureResponse(response)) return response;

    const delayMs = rateLimitDelayMs(response.error, retries);
    const canRetry =
      response.error.outcome_unknown !== true &&
      delayMs !== undefined &&
      retries < MAX_RATE_LIMIT_RETRIES &&
      transport.clock.now() - startedAt + delayMs <= RATE_LIMIT_RETRY_BUDGET_MS;
    if (!canRetry) throw failureError(params.label, response);

    retries += 1;
    try {
      await transport.clock.sleep(delayMs, params.signal);
    } catch (error) {
      // The rate-limited attempt never ran, so nothing reached the provider.
      throw cancelledError({
        label: params.label,
        callId: callIdOf(response),
        outcomeUnknown: false,
        cause: error,
      });
    }
  }
}

async function post<T>(
  transport: Transport,
  params: SendParams<T>,
  body: string,
): Promise<T | ToolFailureResponseV1> {
  if (params.signal?.aborted) {
    throw cancelledError({
      label: params.label,
      callId: null,
      outcomeUnknown: false,
      cause: params.signal.reason,
    });
  }

  let response: Response;
  let payload: unknown;
  try {
    response = await transport.fetch(`${transport.baseUrl}${params.path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${transport.token}`,
        'content-type': 'application/json',
      },
      body,
      ...(params.signal ? {signal: params.signal} : {}),
    });
    payload = await response.json().catch((error: unknown) => {
      if (params.signal?.aborted) throw error;
      return undefined;
    });
  } catch (error) {
    if (params.signal?.aborted) {
      throw cancelledError({label: params.label, callId: null, outcomeUnknown: true, cause: error});
    }
    throw new ToolCallError({
      code: 'endpoint-unavailable',
      message: `${params.label}: the local tool endpoint did not answer.`,
      outcomeUnknown: true,
      callId: null,
      cause: error,
    });
  }

  if (isFailureResponse(payload)) return payload;
  if (response.ok && params.isSuccess(payload)) return payload;
  throw new ToolCallError({
    code: 'invalid-response',
    message: `${params.label}: the local tool endpoint returned an unexpected response (HTTP ${response.status}).`,
    outcomeUnknown: true,
    callId: callIdOf(payload),
  });
}

function rateLimitDelayMs(error: ToolErrorV1, retries: number): number | undefined {
  if (error.code !== 'rate-limited') return undefined;
  if (isPositiveFiniteNumber(error.retry_after_seconds)) return error.retry_after_seconds * 1000;
  return DEFAULT_RATE_LIMIT_DELAY_MS * 2 ** retries;
}

function failureError(label: string, response: ToolFailureResponseV1): ToolCallError {
  const {error} = response;
  return new ToolCallError({
    code: error.code,
    message: `${label}: ${error.message}`,
    reason: error.reason,
    retryAfterSeconds: error.retry_after_seconds,
    outcomeUnknown: error.outcome_unknown === true,
    callId: callIdOf(response),
  });
}

function cancelledError(params: {
  label: string;
  callId: string | null;
  outcomeUnknown: boolean;
  cause: unknown;
}): ToolCallError {
  return new ToolCallError({
    code: 'cancelled',
    message: `${params.label}: the call was cancelled.`,
    outcomeUnknown: params.outcomeUnknown,
    callId: params.callId,
    cause: params.cause,
  });
}

function isFailureResponse(value: unknown): value is ToolFailureResponseV1 {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string' && typeof value.error.message === 'string';
}

function isCallSuccess(value: unknown): value is ToolCallSuccessResponseV1 {
  return isSuccessEnvelope(value) && isRecord(value.result) && Array.isArray(value.result.content);
}

function isDownloadSuccess(value: unknown): value is ToolDownloadSuccessResponseV1 {
  return isSuccessEnvelope(value) && isRecord(value.file) && typeof value.file.path === 'string';
}

function isSuccessEnvelope(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.ok === true && typeof value.call_id === 'string';
}

function callIdOf(value: unknown): string | null {
  return isRecord(value) && typeof value.call_id === 'string' ? value.call_id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const systemClock: RetryClock = {
  now: () => Date.now(),
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
