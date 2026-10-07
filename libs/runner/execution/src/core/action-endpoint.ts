import {randomBytes, randomUUID} from 'node:crypto';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {Readable} from 'node:stream';
import {
  MAX_DOWNLOAD_FILE_BYTES,
  MAX_STEP_DOWNLOAD_BYTES,
  MAX_TOOL_REQUEST_BYTES,
  TOOLS_CALL_PATH,
  TOOLS_DOWNLOAD_PATH,
  TOOLS_LIST_PATH,
  type ToolCallResponseV1,
  type ToolContentBlockV1,
  type ToolDownloadResponseV1,
  type ToolErrorV1,
  type ToolFailureResponseV1,
  type ToolListResponseV1,
} from '@shipfox/actions/contract';
import {
  createDownloadBudget,
  type DownloadBudget,
  type DownloadTarget,
  DownloadWriteError,
  resolveDownloadTarget,
  writeDownloadedFile,
} from '@shipfox/actions/download-writer';
import {type ExecutionHost, localExecutionHost} from '@shipfox/runner-container';

export const ACTION_TOOL_CALL_TIMEOUT_MS = 120_000;
// Under the 300 s response header timeout of the SDK's fetch, so the action gets `timeout`.
export const ACTION_TOOL_DOWNLOAD_TIMEOUT_MS = 290_000;
/** Calls and downloads share these slots. */
export const MAX_CONCURRENT_ACTION_TOOL_CALLS = 8;
// Bounded below the step log's upload window, which never splits a record.
const MAX_TOOL_ROW_PREVIEW_BYTES = 64 * 1024;
const TOOL_ROW_TRUNCATION_MARKER = '\n...[truncated]';
const CALL_ID_HEADER = 'x-shipfox-call-id';
// The runner's remaining milliseconds, so the gateway gives up first and its error arrives.
const DEADLINE_HEADER = 'x-shipfox-deadline';
const FILENAME_HEADER = 'x-shipfox-filename';
const SIZE_HEADER = 'x-shipfox-size';
const RFC5987_UTF8_PREFIX = "UTF-8''";
const DEFAULT_MEDIA_TYPE = 'application/octet-stream';

/** The per-step loopback endpoint an action process reaches through `SHIPFOX_ACTIONS_URL`. */
export interface ActionEndpoint {
  readonly url: string;
  /** Random bearer for this step. It dies when the endpoint closes. */
  readonly token: string;
  /** Refuses new calls, aborts the ones in flight, waits for their rows, and stops listening. */
  close(): Promise<void>;
}

export interface ActionIntegrationGrant {
  readonly alias: string;
  readonly connectionSlug: string;
  readonly tools: readonly ActionToolGrant[];
}

export interface ActionToolGrant {
  readonly id: string;
  readonly sensitivity: 'read' | 'write';
  /** Keeps the arguments and result out of the step log. */
  readonly sensitive: boolean;
  readonly result: 'json' | 'file';
  readonly inputSchema: unknown;
  readonly methods?: readonly ActionToolMethodGrant[] | undefined;
}

export interface ActionToolMethodGrant {
  readonly id: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
}

/** The integration tools gateway, reached with the runner's lease token. */
export interface ActionToolsUpstream {
  callTool(
    params: {name: string; arguments: Record<string, unknown>},
    options: {signal: AbortSignal; timeout: number; headers: Record<string, string>},
  ): Promise<{
    content?: readonly unknown[] | undefined;
    structuredContent?: unknown;
    isError?: boolean | undefined;
  }>;
  /**
   * Posts a file tool call to the gateway download route and resolves with its response, whose
   * body streams the file. Without it, every download fails with `tools-unavailable`.
   */
  downloadFile?(
    request: {connectionSlug: string; tool: string; arguments: Record<string, unknown>},
    options: {signal: AbortSignal; headers: Record<string, string>},
  ): Promise<Response>;
}

/** A tool call or tool result row for the step log. The call id pairs the two. */
export type ActionToolRow =
  | {kind: 'tool-call'; timestamp: number; id: string; name: string; input: string}
  | {
      kind: 'tool-result';
      timestamp: number;
      toolCallId: string;
      toolName: string;
      output: string;
      isError: boolean;
    };

export interface StartActionEndpointParams {
  /** Where downloaded files are written. Defaults to the runner's own machine. */
  host?: ExecutionHost | undefined;
  integrations: readonly ActionIntegrationGrant[];
  /** The step working directory. Download destinations resolve against it. */
  cwd: string;
  /** The job workspace. Downloads must land inside it. */
  workspace: string;
  /** Without it, every call fails with `tools-unavailable`. */
  upstream?: ActionToolsUpstream | undefined;
  /** Step cancellation. It stops new calls and aborts the ones in flight. */
  signal?: AbortSignal | undefined;
  onToolRow?: ((row: ActionToolRow) => void) | undefined;
  callTimeoutMs?: number;
  downloadTimeoutMs?: number;
  now?: () => number;
}

interface ResolvedTool {
  /** The gateway MCP name, `<slug with - replaced by _>__<toolId>`. */
  name: string;
  /**
   * The step log name, `<alias>__<tool>` as the action called it. Two aliases can bind the same
   * connection, and the run page matches rows by alias.
   */
  rowName: string;
  connectionSlug: string;
  /** The granted tool id, without the method of a `family.method` name. */
  toolId: string;
  arguments: Record<string, unknown>;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
}

type JsonBody =
  | ToolCallResponseV1
  | ToolDownloadResponseV1
  | ToolListResponseV1
  | ToolFailureResponseV1;

interface ToolRequest {
  alias: string;
  tool: string;
  arguments: Record<string, unknown>;
  destination?: string | undefined;
}

type Admission =
  | {tool: ResolvedTool; upstream: ActionToolsUpstream; destination: string | undefined}
  | {status: number; body: JsonBody};

export async function startActionEndpoint(
  params: StartActionEndpointParams,
): Promise<ActionEndpoint> {
  const token = randomBytes(32).toString('base64url');
  const callTimeoutMs = params.callTimeoutMs ?? ACTION_TOOL_CALL_TIMEOUT_MS;
  const downloadTimeoutMs = params.downloadTimeoutMs ?? ACTION_TOOL_DOWNLOAD_TIMEOUT_MS;
  const downloadBudget = createDownloadBudget(MAX_STEP_DOWNLOAD_BYTES);
  const host = params.host ?? localExecutionHost;
  const now = params.now ?? Date.now;
  const toolList = listTools(params.integrations);
  const limiter = createLimiter(MAX_CONCURRENT_ACTION_TOOL_CALLS);
  const inFlight = new Set<AbortController>();
  const handlers = new Set<Promise<void>>();
  let accepting = true;
  let port = 0;

  const stopCalls = () => {
    accepting = false;
    for (const controller of inFlight) controller.abort(new Error('The step ended.'));
  };
  if (params.signal?.aborted) stopCalls();
  else params.signal?.addEventListener('abort', stopCalls, {once: true});

  // Parses and checks a request before it reaches the gateway. Refusals carry no call id.
  const admit = async (request: IncomingMessage, kind: 'json' | 'file'): Promise<Admission> => {
    const call = await readToolRequest(request, kind);
    if ('status' in call) return call;
    if (!accepting) {
      return {
        status: 503,
        body: failure('cancelled', 'The step is ending, so no new calls start.'),
      };
    }
    const resolved = resolveTool(params.integrations, call, kind);
    if ('error' in resolved) {
      return {status: resolved.status, body: {ok: false, call_id: null, error: resolved.error}};
    }
    if (params.upstream === undefined || (kind === 'file' && !params.upstream.downloadFile)) {
      return {
        status: 503,
        body: failure('tools-unavailable', 'This runner does not serve tool calls to actions.'),
      };
    }
    return {tool: resolved, upstream: params.upstream, destination: call.destination};
  };

  // Runs one admitted request in a concurrency slot, aborting it on disconnect or step end.
  const serve = async (
    response: ServerResponse,
    run: (controller: AbortController) => Promise<JsonBody>,
  ) => {
    const controller = new AbortController();
    inFlight.add(controller);
    // The step may have ended while the request was admitted.
    if (!accepting) controller.abort(new Error('The step ended.'));
    response.once('close', () => {
      if (!response.writableFinished) controller.abort(new Error('The action disconnected.'));
    });
    try {
      if (!(await limiter.acquire(controller.signal))) {
        send(response, 200, failure('cancelled', 'The call was cancelled before it started.'));
        return;
      }
      try {
        send(response, 200, await run(controller));
      } finally {
        limiter.release();
      }
    } finally {
      inFlight.delete(controller);
    }
  };

  const handleCall = async (request: IncomingMessage, response: ServerResponse) => {
    const admitted = await admit(request, 'json');
    if ('status' in admitted) {
      send(response, admitted.status, admitted.body);
      return;
    }
    await serve(response, (controller) =>
      forward({
        upstream: admitted.upstream,
        tool: admitted.tool,
        controller,
        callTimeoutMs,
        now,
        onToolRow: params.onToolRow,
      }),
    );
  };

  const handleDownload = async (request: IncomingMessage, response: ServerResponse) => {
    const admitted = await admit(request, 'file');
    if ('status' in admitted) {
      send(response, admitted.status, admitted.body);
      return;
    }
    let target: DownloadTarget;
    try {
      target = await resolveDownloadTarget({
        workspace: params.workspace,
        cwd: params.cwd,
        destination: admitted.destination ?? '',
      });
    } catch (error) {
      const code = error instanceof DownloadWriteError ? error.code : 'invalid-destination';
      const status = code === 'destination-not-allowed' ? 403 : 400;
      const message =
        error instanceof DownloadWriteError
          ? error.message
          : `The destination ${admitted.destination} cannot be used.`;
      send(response, status, failure(code, message));
      return;
    }
    await serve(response, (controller) =>
      forwardDownload({
        download: admitted.upstream.downloadFile as NonNullable<
          ActionToolsUpstream['downloadFile']
        >,
        tool: admitted.tool,
        target,
        host,
        cwd: params.cwd,
        budget: downloadBudget,
        controller,
        downloadTimeoutMs,
        now,
        onToolRow: params.onToolRow,
      }),
    );
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (!isLoopbackHost(request.headers.host, port)) {
      request.resume();
      send(response, 403, failure('forbidden', 'The endpoint only answers loopback requests.'));
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      request.resume();
      response.writeHead(401).end();
      return;
    }
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const route = routeFor(path, request.method);
    if (route === 'call') return await handleCall(request, response);
    if (route === 'download') return await handleDownload(request, response);
    request.resume();
    if (route === 'list') send(response, 200, toolList);
    else if (route === 'method-not-allowed') {
      send(response, 405, failure('method-not-allowed', `${request.method} is not allowed here.`));
    } else send(response, 404, failure('not-found', `${path} is not a tool endpoint route.`));
  };

  const server = createServer((request, response) => {
    const handler = handle(request, response).catch(() => {
      if (!response.headersSent) send(response, 500, failure('internal', 'The call failed.'));
    });
    handlers.add(handler);
    void handler.finally(() => handlers.delete(handler));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  let closePromise: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    close() {
      closePromise ??= (async () => {
        params.signal?.removeEventListener('abort', stopCalls);
        stopCalls();
        await Promise.allSettled([...handlers]);
        await new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        });
      })();
      return closePromise;
    },
  };
}

async function forward(params: {
  upstream: ActionToolsUpstream;
  tool: ResolvedTool;
  controller: AbortController;
  callTimeoutMs: number;
  now: () => number;
  onToolRow: ((row: ActionToolRow) => void) | undefined;
}): Promise<ToolCallResponseV1> {
  const {tool, controller} = params;
  const callId = randomUUID();
  params.onToolRow?.({
    kind: 'tool-call',
    timestamp: params.now(),
    id: callId,
    name: tool.rowName,
    input: tool.sensitive ? '[sensitive tool arguments redacted]' : preview(tool.arguments),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('The tool call timed out.'));
  }, params.callTimeoutMs);
  let response: ToolCallResponseV1;
  try {
    const result = await params.upstream.callTool(
      {name: tool.name, arguments: tool.arguments},
      {
        signal: controller.signal,
        timeout: params.callTimeoutMs,
        headers: {[CALL_ID_HEADER]: callId},
      },
    );
    response = result.isError
      ? {ok: false, call_id: callId, error: gatewayError(result, tool.sensitivity)}
      : {
          ok: true,
          call_id: callId,
          result: {
            structured: result.structuredContent ?? null,
            content: (result.content ?? []) as readonly ToolContentBlockV1[],
          },
        };
  } catch {
    response = {
      ok: false,
      call_id: callId,
      error: transportError({
        timedOut,
        aborted: controller.signal.aborted,
        callTimeoutMs: params.callTimeoutMs,
        // A write that may have reached the gateway could have taken effect.
        outcomeUnknown: tool.sensitivity === 'write',
      }),
    };
  } finally {
    clearTimeout(timer);
  }

  params.onToolRow?.({
    kind: 'tool-result',
    timestamp: params.now(),
    toolCallId: callId,
    toolName: tool.rowName,
    output: tool.sensitive
      ? '[sensitive tool result redacted]'
      : preview(response.ok ? response.result : response.error),
    isError: !response.ok,
  });
  return response;
}

async function forwardDownload(params: {
  download: NonNullable<ActionToolsUpstream['downloadFile']>;
  tool: ResolvedTool;
  target: DownloadTarget;
  host: ExecutionHost;
  cwd: string;
  budget: DownloadBudget;
  controller: AbortController;
  downloadTimeoutMs: number;
  now: () => number;
  onToolRow: ((row: ActionToolRow) => void) | undefined;
}): Promise<ToolDownloadResponseV1> {
  const {tool, controller} = params;
  const callId = randomUUID();
  params.onToolRow?.({
    kind: 'tool-call',
    timestamp: params.now(),
    id: callId,
    name: tool.rowName,
    input: tool.sensitive ? '[sensitive tool arguments redacted]' : preview(tool.arguments),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('The download timed out.'));
  }, params.downloadTimeoutMs);
  let response: ToolDownloadResponseV1;
  try {
    const upstream = await params.download(
      {connectionSlug: tool.connectionSlug, tool: tool.toolId, arguments: tool.arguments},
      {
        signal: controller.signal,
        headers: {
          [CALL_ID_HEADER]: callId,
          [DEADLINE_HEADER]: String(params.downloadTimeoutMs),
        },
      },
    );
    const refusal = upstream.ok ? earlyRefusal(upstream) : await gatewayDownloadError(upstream);
    if (refusal !== undefined) {
      await upstream.body?.cancel().catch(() => undefined);
      response = {ok: false, call_id: callId, error: refusal};
    } else {
      const file = await writeDownloadedFile({
        target: params.target,
        cwd: params.cwd,
        filename: decodeFilename(upstream.headers.get(FILENAME_HEADER)),
        fallbackName: `download-${callId}`,
        body: upstream.body ?? Readable.from([]),
        maxBytes: MAX_DOWNLOAD_FILE_BYTES,
        budget: params.budget,
        signal: controller.signal,
        writePartial: ({path, source, signal}) =>
          params.host.writeFile(path, source, {exclusive: true, signal}),
      });
      response = {
        ok: true,
        call_id: callId,
        file: {
          path: file.path,
          bytes: file.bytes,
          sha256: file.sha256,
          media_type: upstream.headers.get('content-type') ?? DEFAULT_MEDIA_TYPE,
          filename: file.filename,
        },
      };
    }
  } catch (error) {
    response = {
      ok: false,
      call_id: callId,
      error:
        error instanceof DownloadWriteError
          ? {code: error.code, message: error.message, outcome_unknown: false}
          : downloadTransportError({
              error,
              timedOut,
              aborted: controller.signal.aborted,
              downloadTimeoutMs: params.downloadTimeoutMs,
            }),
    };
  } finally {
    clearTimeout(timer);
  }
  // Stops a body the writer left unread, so the gateway stops sending.
  if (!response.ok) controller.abort(new Error('The download failed.'));

  params.onToolRow?.({
    kind: 'tool-result',
    timestamp: params.now(),
    toolCallId: callId,
    toolName: tool.rowName,
    output: tool.sensitive
      ? '[sensitive tool result redacted]'
      : preview(response.ok ? response.file : response.error),
    isError: !response.ok,
  });
  return response;
}

// The gateway sends the size when the provider knows it, so an oversized file fails before any byte.
function earlyRefusal(response: Response): ToolErrorV1 | undefined {
  const size = Number(response.headers.get(SIZE_HEADER) ?? Number.NaN);
  if (!(size > MAX_DOWNLOAD_FILE_BYTES)) return undefined;
  return {
    code: 'file-too-large',
    message: `The file is larger than the ${MAX_DOWNLOAD_FILE_BYTES} byte download limit.`,
    outcome_unknown: false,
  };
}

async function gatewayDownloadError(response: Response): Promise<ToolErrorV1> {
  const body: unknown = await response.json().catch(() => undefined);
  const payload = isRecord(body) ? body : {};
  const details = isRecord(payload.details) ? payload.details : {};
  const retryAfter = details.retryAfterSeconds;
  const message = [details.message, payload.message].find(
    (candidate): candidate is string => typeof candidate === 'string' && candidate !== '',
  );
  return {
    code: typeof payload.code === 'string' ? payload.code : 'tool-error',
    ...(typeof details.reason === 'string' ? {reason: details.reason} : {}),
    message: message ?? `The tool gateway refused the download with HTTP ${response.status}.`,
    ...(typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
      ? {retry_after_seconds: retryAfter}
      : {}),
    outcome_unknown: false,
  };
}

function downloadTransportError(params: {
  error: unknown;
  timedOut: boolean;
  aborted: boolean;
  downloadTimeoutMs: number;
}): ToolErrorV1 {
  if (params.timedOut) {
    return {
      code: 'timeout',
      message: `The download did not finish within ${params.downloadTimeoutMs / 1000} seconds.`,
      outcome_unknown: false,
    };
  }
  if (params.aborted) {
    return {code: 'cancelled', message: 'The download was cancelled.', outcome_unknown: false};
  }
  // File system errors carry the failing syscall; network errors do not.
  if (isRecord(params.error) && typeof params.error.syscall === 'string') {
    return {
      code: 'write-failed',
      message: 'The runner could not write the file into the workspace.',
      outcome_unknown: false,
    };
  }
  return {
    code: 'gateway-unavailable',
    message: 'The Shipfox tool gateway did not finish sending the file.',
    outcome_unknown: false,
  };
}

// The gateway encodes the provider filename as an RFC 5987 value.
function decodeFilename(header: string | null): string | undefined {
  if (header === null || !header.startsWith(RFC5987_UTF8_PREFIX)) return undefined;
  try {
    return decodeURIComponent(header.slice(RFC5987_UTF8_PREFIX.length));
  } catch {
    return undefined;
  }
}

function resolveTool(
  integrations: readonly ActionIntegrationGrant[],
  call: ToolRequest,
  kind: 'json' | 'file',
): ResolvedTool | {status: number; error: ToolErrorV1} {
  const integration = integrations.find((candidate) => candidate.alias === call.alias);
  if (integration === undefined) {
    return notGranted(`The step binds no integration named "${call.alias}".`);
  }

  const granted = findGrant(integration, call.tool);
  if (granted === undefined) {
    return notGranted(`The action is not granted ${call.alias}.${call.tool}.`);
  }
  const {grant, method} = granted;
  if (grant.result !== kind) {
    return {
      status: 400,
      error: {
        code: 'tool-result-kind-mismatch',
        message:
          grant.result === 'file'
            ? `${call.tool} returns a file. Use download() instead of call().`
            : `${call.tool} does not return a file. Use call() instead of download().`,
        outcome_unknown: false,
      },
    };
  }

  return {
    name: `${integration.connectionSlug.replaceAll('-', '_')}__${grant.id}`,
    rowName: `${call.alias}__${call.tool}`,
    connectionSlug: integration.connectionSlug,
    toolId: grant.id,
    arguments: method === undefined ? call.arguments : {...call.arguments, method: method.id},
    sensitivity: method?.sensitivity ?? grant.sensitivity,
    sensitive: method?.sensitive ?? grant.sensitive,
  };
}

// `family.method` names one method of a method-family tool.
function findGrant(
  integration: ActionIntegrationGrant,
  tool: string,
): {grant: ActionToolGrant; method?: ActionToolMethodGrant} | undefined {
  const exact = integration.tools.find((candidate) => candidate.id === tool);
  if (exact !== undefined) return {grant: exact};
  const separator = tool.indexOf('.');
  if (separator === -1) return undefined;
  const family = tool.slice(0, separator);
  const methodId = tool.slice(separator + 1);
  const grant = integration.tools.find((candidate) => candidate.id === family);
  const method = grant?.methods?.find((candidate) => candidate.id === methodId);
  return grant === undefined || method === undefined ? undefined : {grant, method};
}

function notGranted(message: string): {status: number; error: ToolErrorV1} {
  return {status: 403, error: {code: 'tool-not-granted', message, outcome_unknown: false}};
}

function gatewayError(
  result: {content?: readonly unknown[] | undefined; structuredContent?: unknown},
  sensitivity: 'read' | 'write',
): ToolErrorV1 {
  const details = isRecord(result.structuredContent) ? result.structuredContent : {};
  const code = typeof details.code === 'string' ? details.code : 'tool-error';
  const retryAfter = details.retryAfterSeconds;
  return {
    code,
    ...(typeof details.reason === 'string' ? {reason: details.reason} : {}),
    message: contentText(result.content) || 'The tool call failed.',
    ...(typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
      ? {retry_after_seconds: retryAfter}
      : {}),
    // The provider received the write but never answered.
    outcome_unknown: sensitivity === 'write' && code === 'provider-timeout',
  };
}

function transportError(params: {
  timedOut: boolean;
  aborted: boolean;
  callTimeoutMs: number;
  outcomeUnknown: boolean;
}): ToolErrorV1 {
  if (params.timedOut) {
    return {
      code: 'timeout',
      message: `The tool call did not finish within ${params.callTimeoutMs / 1000} seconds.`,
      outcome_unknown: params.outcomeUnknown,
    };
  }
  if (params.aborted) {
    return {
      code: 'cancelled',
      message: 'The tool call was cancelled.',
      outcome_unknown: params.outcomeUnknown,
    };
  }
  return {
    code: 'gateway-unavailable',
    message: 'The Shipfox tool gateway did not answer.',
    outcome_unknown: params.outcomeUnknown,
  };
}

function listTools(integrations: readonly ActionIntegrationGrant[]): ToolListResponseV1 {
  return {
    aliases: Object.fromEntries(
      integrations.map((integration) => [
        integration.alias,
        {
          tools: integration.tools.map((tool) => ({
            tool: tool.id,
            input_schema: tool.inputSchema,
            result: tool.result,
          })),
        },
      ]),
    ),
  };
}

function routeFor(
  path: string,
  method: string | undefined,
): 'call' | 'list' | 'download' | 'method-not-allowed' | 'not-found' {
  const routes: Record<string, ['call' | 'list' | 'download', string]> = {
    [TOOLS_CALL_PATH]: ['call', 'POST'],
    [TOOLS_LIST_PATH]: ['list', 'GET'],
    [TOOLS_DOWNLOAD_PATH]: ['download', 'POST'],
  };
  const route = routes[path];
  if (route === undefined) return 'not-found';
  return route[1] === method ? route[0] : 'method-not-allowed';
}

// A browser page on another origin can reach loopback, so a request must name this endpoint.
function isLoopbackHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

// An oversized body is still read to the end, so the client gets the 413 instead of a reset.
async function readBody(request: IncomingMessage): Promise<string | 'too-large' | undefined> {
  let tooLarge = Number(request.headers['content-length']) > MAX_TOOL_REQUEST_BYTES;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      if (tooLarge) continue;
      size += (chunk as Buffer).length;
      tooLarge = size > MAX_TOOL_REQUEST_BYTES;
      if (!tooLarge) chunks.push(chunk as Buffer);
    }
  } catch {
    return undefined;
  }
  return tooLarge ? 'too-large' : Buffer.concat(chunks).toString('utf8');
}

async function readToolRequest(
  request: IncomingMessage,
  kind: 'json' | 'file',
): Promise<ToolRequest | {status: number; body: JsonBody}> {
  const body = await readBody(request);
  if (body === 'too-large') {
    return {
      status: 413,
      body: failure(
        'request-too-large',
        `The request is above the ${MAX_TOOL_REQUEST_BYTES} byte limit.`,
      ),
    };
  }
  const call = body === undefined ? undefined : parseToolRequest(body, kind);
  if (call !== undefined) return call;
  return {
    status: 400,
    body: failure(
      'invalid-request',
      kind === 'file'
        ? 'The request body must be JSON with a string alias, a string tool, an arguments object, and a string destination.'
        : 'The request body must be JSON with a string alias, a string tool, and an arguments object.',
    ),
  };
}

function parseToolRequest(body: string, kind: 'json' | 'file'): ToolRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const {alias, tool} = value;
  const args = value.arguments ?? {};
  if (typeof alias !== 'string' || alias === '') return undefined;
  if (typeof tool !== 'string' || tool === '') return undefined;
  if (!isRecord(args)) return undefined;
  if (kind === 'json') return {alias, tool, arguments: args};
  const {destination} = value;
  if (typeof destination !== 'string' || destination === '') return undefined;
  return {alias, tool, arguments: args, destination};
}

function send(response: ServerResponse, status: number, body: JsonBody): void {
  if (response.destroyed || response.headersSent) return;
  response.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

function failure(code: string, message: string): ToolFailureResponseV1 {
  return {ok: false, call_id: null, error: {code, message, outcome_unknown: false}};
}

function createLimiter(max: number) {
  let active = 0;
  const waiters: (() => void)[] = [];
  return {
    acquire(signal: AbortSignal): Promise<boolean> {
      if (signal.aborted) return Promise.resolve(false);
      if (active < max) {
        active += 1;
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        const waiter = () => {
          signal.removeEventListener('abort', onAbort);
          active += 1;
          resolve(true);
        };
        const onAbort = () => {
          waiters.splice(waiters.indexOf(waiter), 1);
          resolve(false);
        };
        waiters.push(waiter);
        signal.addEventListener('abort', onAbort, {once: true});
      });
    },
    release() {
      active -= 1;
      waiters.shift()?.();
    },
  };
}

function contentText(content: readonly unknown[] | undefined): string {
  return (content ?? [])
    .filter((block): block is {type: 'text'; text: string} => {
      return isRecord(block) && block.type === 'text' && typeof block.text === 'string';
    })
    .map((block) => block.text)
    .join('\n');
}

function preview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= MAX_TOOL_ROW_PREVIEW_BYTES) return text;
  let end = MAX_TOOL_ROW_PREVIEW_BYTES;
  // Back up to a code point boundary so the preview never ends in a torn character.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}${TOOL_ROW_TRUNCATION_MARKER}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
