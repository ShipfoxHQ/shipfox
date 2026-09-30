export type McpCallStatus = 'ok' | 'tool_error' | 'error' | 'accepted' | 'no_response';

export interface McpCallRecord {
  sessionId: string;
  method: string;
  /** The tool name, for `tools/call`. */
  tool?: string;
  /** The tool arguments for `tools/call`, and the request params for every other method. */
  arguments?: unknown;
  status: McpCallStatus;
  httpStatus: number;
  /** A JSON-RPC error, or the agent-access envelope error of a failed tool call. */
  error?: {code: string | number; message?: string};
  startedAt: string;
  durationMs: number;
}

interface JsonRpcMessage {
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {code?: string | number; message?: string};
}

const EVENT_SEPARATOR = /\r?\n\r?\n/u;
const LINE_SEPARATOR = /\r?\n/u;
const LEADING_SPACE = /^ /u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messagesFrom(value: unknown): JsonRpcMessage[] {
  const items = Array.isArray(value) ? value : [value];
  return items.filter(isRecord) as JsonRpcMessage[];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The `data:` payloads of a Server-Sent Events body, one JSON message per event. */
function parseEventStream(text: string): JsonRpcMessage[] {
  const messages: JsonRpcMessage[] = [];
  for (const block of text.split(EVENT_SEPARATOR)) {
    const data = block
      .split(LINE_SEPARATOR)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).replace(LEADING_SPACE, ''))
      .join('\n');
    if (data) messages.push(...messagesFrom(parseJson(data)));
  }
  return messages;
}

export function parseRequestMessages(body: string): JsonRpcMessage[] {
  return messagesFrom(parseJson(body));
}

export function parseResponseMessages(params: {
  contentType: string | null;
  body: string;
}): JsonRpcMessage[] {
  if (params.contentType?.includes('text/event-stream')) return parseEventStream(params.body);
  return messagesFrom(parseJson(params.body));
}

function toolErrorFrom(result: unknown): McpCallRecord['error'] | undefined {
  if (!isRecord(result)) return undefined;
  const envelope = result.structuredContent;
  if (isRecord(envelope) && envelope.ok === false && isRecord(envelope.error)) {
    const {code, message} = envelope.error;
    return {
      code: typeof code === 'string' ? code : 'unknown',
      ...(typeof message === 'string' ? {message} : {}),
    };
  }
  return result.isError === true ? {code: 'tool_error'} : undefined;
}

function outcomeFor(params: {
  request: JsonRpcMessage;
  responses: JsonRpcMessage[];
  httpStatus: number;
}): Pick<McpCallRecord, 'status' | 'error'> {
  const {request, responses, httpStatus} = params;
  const succeeded = httpStatus >= 200 && httpStatus < 300;
  if (request.id === undefined || request.id === null) {
    return {status: succeeded ? 'accepted' : 'error'};
  }
  const response = responses.find(
    (message) => message.id === request.id && message.method === undefined,
  );
  if (!response) return {status: succeeded ? 'no_response' : 'error'};
  if (response.error) {
    return {
      status: 'error',
      error: {
        code: response.error.code ?? 'unknown',
        ...(response.error.message === undefined ? {} : {message: response.error.message}),
      },
    };
  }
  const toolError = toolErrorFrom(response.result);
  return toolError ? {status: 'tool_error', error: toolError} : {status: 'ok'};
}

function toolFields(method: string, params: unknown): Pick<McpCallRecord, 'tool' | 'arguments'> {
  if (method === 'tools/call' && isRecord(params)) {
    return {
      ...(typeof params.name === 'string' ? {tool: params.name} : {}),
      arguments: params.arguments,
    };
  }
  return params === undefined ? {} : {arguments: params};
}

/** One record per JSON-RPC request in the exchange; a batch yields several. */
export function buildCallRecords(params: {
  sessionId: string;
  requestBody: string;
  responseBody: string;
  responseContentType: string | null;
  httpStatus: number;
  startedAt: number;
  finishedAt: number;
}): McpCallRecord[] {
  const requests = parseRequestMessages(params.requestBody).filter(
    (message) => message.method !== undefined,
  );
  const responses = parseResponseMessages({
    contentType: params.responseContentType,
    body: params.responseBody,
  });
  // Requests that are not JSON-RPC still reach the API, so they are logged rather than dropped.
  const subjects: JsonRpcMessage[] = requests.length > 0 ? requests : [{method: 'unparseable'}];

  return subjects.map((request) => {
    const method = request.method ?? 'unparseable';
    return {
      sessionId: params.sessionId,
      method,
      ...toolFields(method, request.params),
      ...outcomeFor({request, responses, httpStatus: params.httpStatus}),
      httpStatus: params.httpStatus,
      startedAt: new Date(params.startedAt).toISOString(),
      durationMs: params.finishedAt - params.startedAt,
    };
  });
}
