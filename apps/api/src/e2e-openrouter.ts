import {randomUUID} from 'node:crypto';
import type {InferenceSegmentInputDto} from '@shipfox/api-usage-dto';
import {logger} from '@shipfox/node-opentelemetry';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Catalog model IDs served through OpenRouter, with the OpenRouter model ID each one calls. The
 * provider declares every model here as `openai-completions`, so pi sends chat completions.
 */
export const OPENROUTER_MODEL_IDS: Readonly<Record<string, string>> = {
  'gpt-6-luna': 'openai/gpt-6-luna',
  'gpt-6-sol': 'openai/gpt-6-sol',
  'glm-5.3-flash': 'z-ai/glm-5.3-flash',
};

export interface OpenRouterBackend {
  apiKey: string;
  baseUrl?: string | undefined;
}

export type InferenceUsageIdentity = Pick<
  InferenceSegmentInputDto,
  | 'workspaceId'
  | 'projectId'
  | 'workflowRunId'
  | 'workflowRunAttemptId'
  | 'jobId'
  | 'jobExecutionId'
  | 'stepId'
  | 'stepAttemptId'
>;

export type RecordInferenceSegment = (segment: InferenceSegmentInputDto) => Promise<void>;

export interface InferenceReply {
  code(statusCode: number): InferenceReply;
  header(name: string, value: string): InferenceReply;
  hijack(): unknown;
  raw: {
    end(chunk?: string): unknown;
    on(event: 'close', listener: () => void): unknown;
    write(chunk: string): unknown;
    writeHead(statusCode: number, headers: Record<string, string>): unknown;
  };
  send(payload: unknown): unknown;
}

interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

/** Forwards one OpenAI chat completion to OpenRouter and records the usage it reports. */
export async function forwardToOpenRouter(params: {
  backend: OpenRouterBackend;
  body: unknown;
  identity: InferenceUsageIdentity;
  record: RecordInferenceSegment | undefined;
  reply: InferenceReply;
}): Promise<unknown> {
  const {backend, body, identity, record, reply} = params;
  const catalogModel = isRecord(body) && typeof body.model === 'string' ? body.model : undefined;
  if (
    !isRecord(body) ||
    catalogModel === undefined ||
    !Object.hasOwn(OPENROUTER_MODEL_IDS, catalogModel)
  ) {
    return sendError(
      reply,
      422,
      'openrouter_model_unmapped',
      `No OpenRouter model is mapped for ${catalogModel ?? 'an unnamed model'}.`,
    );
  }

  const streaming = body.stream === true;
  const abort = new AbortController();
  reply.raw.on('close', () => abort.abort());
  const windowStart = new Date();
  let response: Response;
  try {
    response = await fetch(`${backend.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${backend.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(upstreamBody(body, OPENROUTER_MODEL_IDS[catalogModel] ?? catalogModel)),
      signal: abort.signal,
    });
  } catch {
    return sendError(reply, 502, 'openrouter_unreachable', 'OpenRouter could not be reached.');
  }

  const recordUsage = async (usage: CompletionUsage | undefined) => {
    if (usage === undefined || record === undefined) return;
    try {
      await record(toSegment({identity, model: catalogModel, usage, windowStart}));
    } catch (error) {
      logger().error({err: error}, 'E2E OpenRouter usage segment was not recorded');
    }
  };
  if (streaming && response.ok && response.body !== null) {
    return relayStream({body: response.body, reply, status: response.status, recordUsage});
  }
  const text = await response.text();
  if (response.ok) await recordUsage(completionUsage(parseJson(text)?.usage));
  return reply
    .code(response.status)
    .header('content-type', response.headers.get('content-type') ?? 'application/json')
    .send(text);
}

/** Asks a streamed completion to end with its usage, which OpenRouter otherwise may leave out. */
function upstreamBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
  if (body.stream !== true) return {...body, model};
  return {
    ...body,
    model,
    stream_options: {
      ...(isRecord(body.stream_options) ? body.stream_options : {}),
      include_usage: true,
    },
  };
}

async function relayStream(params: {
  body: ReadableStream<Uint8Array>;
  reply: InferenceReply;
  status: number;
  recordUsage: (usage: CompletionUsage | undefined) => Promise<void>;
}): Promise<unknown> {
  const {reply} = params;
  reply.hijack();
  reply.raw.writeHead(params.status, {
    'cache-control': 'no-cache',
    'content-type': 'text/event-stream; charset=utf-8',
  });
  const decoder = new TextDecoder();
  const usageScanner = createStreamUsageScanner();
  const reader = params.body.getReader();
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const text = decoder.decode(chunk.value, {stream: true});
      usageScanner.push(text);
      reply.raw.write(text);
      chunk = await reader.read();
    }
    await params.recordUsage(usageScanner.usage());
  } catch {
    // The client closed the stream or the upstream connection dropped. Both end the response.
  }
  return reply.raw.end();
}

function toSegment(params: {
  identity: InferenceUsageIdentity;
  model: string;
  usage: CompletionUsage;
  windowStart: Date;
}): InferenceSegmentInputDto {
  return {
    ...params.identity,
    segmentKey: `e2e-openrouter:${randomUUID()}`,
    source: 'gateway',
    upstream: 'openrouter',
    model: params.model,
    dialect: 'openai-completions',
    windowStart: params.windowStart.toISOString(),
    windowEnd: new Date().toISOString(),
    requestCount: 1,
    inputTokens: params.usage.inputTokens,
    outputTokens: params.usage.outputTokens,
    cacheCreationTokens: 0,
    cacheReadTokens: params.usage.cacheReadTokens,
    reasoningTokens: params.usage.reasoningTokens,
    webSearchRequests: 0,
  };
}

/** Reads the usage object of a streamed completion, which the last data chunk carries. */
function createStreamUsageScanner(): {
  push(chunk: string): void;
  usage(): CompletionUsage | undefined;
} {
  let pending = '';
  let usage: CompletionUsage | undefined;
  const scanLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice('data:'.length).trim();
    if (data === '' || data === '[DONE]') return;
    usage = completionUsage(parseJson(data)?.usage) ?? usage;
  };
  return {
    push: (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) scanLine(line);
    },
    usage: () => {
      scanLine(pending);
      pending = '';
      return usage;
    },
  };
}

function completionUsage(value: unknown): CompletionUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = tokenCount(value.prompt_tokens);
  const outputTokens = tokenCount(value.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens:
      tokenCount(
        isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details.cached_tokens : 0,
      ) ?? 0,
    reasoningTokens:
      tokenCount(
        isRecord(value.completion_tokens_details)
          ? value.completion_tokens_details.reasoning_tokens
          : 0,
      ) ?? 0,
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function sendError(reply: InferenceReply, status: number, type: string, message: string): unknown {
  return reply.code(status).send({error: {message, type}});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
