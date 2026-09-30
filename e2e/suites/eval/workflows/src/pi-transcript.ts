import {type StartObservationOptions, startObservation} from '@langfuse/tracing';
import {z} from 'zod';
import {base64DataUri} from './media.js';

const usageSchema = z.looseObject({
  input: z.number().optional(),
  output: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  reasoning: z.number().optional(),
  totalTokens: z.number().optional(),
  cost: z
    .looseObject({
      input: z.number().optional(),
      output: z.number().optional(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
      total: z.number().optional(),
    })
    .optional(),
});

const messageSchema = z.looseObject({
  role: z.string(),
  content: z.unknown().optional(),
  timestamp: z.number().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  api: z.string().optional(),
  usage: usageSchema.optional().catch(undefined),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  isError: z.boolean().optional(),
});

const entrySchema = z.looseObject({
  type: z.string(),
  timestamp: z.string().optional(),
  message: messageSchema.optional(),
});

type Usage = z.infer<typeof usageSchema>;

export interface PiToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

type SpanContext = NonNullable<StartObservationOptions['parentSpanContext']>;

export interface PiChatMessage {
  role: string;
  content: string;
  thinking?: string;
  tool_calls?: PiToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface PiModelCall {
  startTime: Date;
  endTime: Date;
  model: string | undefined;
  provider: string | undefined;
  api: string | undefined;
  /** Every message the model saw before it answered. */
  input: PiChatMessage[];
  output: PiChatMessage;
  usage: Usage | undefined;
  stopReason: string | undefined;
  errorMessage: string | undefined;
}

export interface PiToolExecution {
  id: string;
  name: string;
  arguments: unknown;
  startTime: Date;
  endTime: Date;
  /** Undefined when the session ended before the tool reported a result. */
  result: string | undefined;
  isError: boolean;
}

export interface PiTranscript {
  modelCalls: PiModelCall[];
  toolExecutions: PiToolExecution[];
  startTime: Date | undefined;
  endTime: Date | undefined;
  /** Lines that were not valid session entries, which points at format drift when many. */
  skippedLines: number;
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

function contentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is ContentBlock => typeof block === 'object' && block !== null,
  );
}

function blockText(block: ContentBlock): string {
  if (block.type === 'image') return '[image]';
  return block.text ?? '';
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  return contentBlocks(content)
    .filter((block) => block.type !== 'thinking' && block.type !== 'toolCall')
    .map(blockText)
    .filter(Boolean)
    .join('\n\n');
}

function chatMessage(message: z.infer<typeof messageSchema>): PiChatMessage {
  if (message.role === 'toolResult') {
    return {
      role: 'tool',
      content: messageText(message.content),
      ...(message.toolCallId === undefined ? {} : {tool_call_id: message.toolCallId}),
      ...(message.toolName === undefined ? {} : {name: message.toolName}),
    };
  }
  const blocks = contentBlocks(message.content);
  const thinking = blocks
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking ?? block.text ?? '')
    .filter(Boolean)
    .join('\n\n');
  const toolCalls = blocks
    .filter((block) => block.type === 'toolCall')
    .map((block) => ({id: block.id ?? '', name: block.name ?? 'tool', arguments: block.arguments}));
  return {
    role: message.role,
    content: messageText(message.content),
    ...(thinking ? {thinking} : {}),
    ...(toolCalls.length > 0 ? {tool_calls: toolCalls} : {}),
  };
}

function parseEntries(jsonl: string): {
  entries: z.infer<typeof entrySchema>[];
  skippedLines: number;
} {
  const entries: z.infer<typeof entrySchema>[] = [];
  let skippedLines = 0;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    const parsed = entrySchema.safeParse(parseJsonLine(line));
    if (parsed.success) entries.push(parsed.data);
    else skippedLines += 1;
  }
  return {entries, skippedLines};
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function validDate(value: number | undefined): Date | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return new Date(value);
}

function latest(...dates: (Date | undefined)[]): Date | undefined {
  return dates.reduce<Date | undefined>(
    (max, date) => (date !== undefined && (max === undefined || date > max) ? date : max),
    undefined,
  );
}

type SessionMessage = z.infer<typeof messageSchema>;

function entryDate(timestamp: string | undefined): Date | undefined {
  if (timestamp === undefined) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

class TranscriptBuilder {
  readonly modelCalls: PiModelCall[] = [];
  readonly executions = new Map<string, PiToolExecution>();
  private readonly history: PiChatMessage[] = [];
  private cursor: Date | undefined;

  addAssistant({
    message,
    chat,
    entryTime,
  }: {
    message: SessionMessage;
    chat: PiChatMessage;
    entryTime: Date | undefined;
  }): void {
    const messageTime = validDate(message.timestamp);
    const endTime = latest(entryTime ?? messageTime, this.cursor) ?? new Date();
    const startTime = messageTime !== undefined && messageTime < endTime ? messageTime : endTime;
    this.modelCalls.push({
      startTime,
      endTime,
      model: message.model,
      provider: message.provider,
      api: message.api,
      input: [...this.history],
      output: chat,
      usage: message.usage,
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
    });
    for (const call of chat.tool_calls ?? []) {
      this.executions.set(call.id, {
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        startTime: endTime,
        endTime,
        result: undefined,
        isError: false,
      });
    }
    this.cursor = endTime;
  }

  addToolResult({
    message,
    chat,
    entryTime,
    toolCallId,
  }: {
    message: SessionMessage;
    chat: PiChatMessage;
    entryTime: Date | undefined;
    toolCallId: string;
  }): void {
    const execution = this.executions.get(toolCallId);
    const resultTime = validDate(message.timestamp) ?? entryTime;
    if (execution !== undefined) {
      execution.result = chat.content;
      execution.isError = message.isError === true;
      execution.endTime = latest(resultTime, execution.startTime) ?? execution.startTime;
    }
    this.cursor = latest(this.cursor, execution?.endTime, resultTime);
  }

  addHistory(chat: PiChatMessage): void {
    this.history.push(chat);
  }
}

/**
 * Splits a pi session into model calls and tool executions.
 *
 * pi stamps an assistant message when the request starts and stamps its session entry when the
 * message is complete, so the pair bounds the model call. A tool starts when the assistant message
 * that requested it completes and ends when its result message is stamped.
 */
export function parsePiTranscript(jsonl: string): PiTranscript {
  const builder = new TranscriptBuilder();
  let firstTime: Date | undefined;

  const {entries, skippedLines} = parseEntries(jsonl);
  for (const entry of entries) {
    const entryTime = entryDate(entry.timestamp);
    firstTime ??= entryTime;
    const message = entry.message;
    if (entry.type !== 'message' || message === undefined) continue;

    const chat = chatMessage(message);
    if (message.role === 'assistant') {
      builder.addAssistant({message, chat, entryTime});
    } else if (message.role === 'toolResult' && message.toolCallId !== undefined) {
      builder.addToolResult({message, chat, entryTime, toolCallId: message.toolCallId});
    }
    builder.addHistory(chat);
  }

  const times = [
    firstTime,
    ...builder.modelCalls.flatMap((call) => [call.startTime, call.endTime]),
    ...[...builder.executions.values()].map((execution) => execution.endTime),
  ].filter((time): time is Date => time !== undefined);
  const sorted = [...times].sort((left, right) => left.getTime() - right.getTime());

  return {
    modelCalls: builder.modelCalls,
    toolExecutions: [...builder.executions.values()],
    startTime: sorted[0],
    endTime: sorted.at(-1),
    skippedLines,
  };
}

function usageDetails(usage: Usage | undefined): Record<string, number> | undefined {
  if (usage === undefined) return undefined;
  const details: Record<string, number> = {};
  if (usage.input !== undefined) details.input = usage.input;
  if (usage.output !== undefined) details.output = usage.output;
  if (usage.cacheRead !== undefined) details.cache_read_input_tokens = usage.cacheRead;
  if (usage.cacheWrite !== undefined) details.cache_creation_input_tokens = usage.cacheWrite;
  if (usage.reasoning !== undefined) details.output_reasoning_tokens = usage.reasoning;
  if (usage.totalTokens !== undefined) details.total = usage.totalTokens;
  return Object.keys(details).length === 0 ? undefined : details;
}

function costDetails(usage: Usage | undefined): Record<string, number> | undefined {
  const cost = usage?.cost;
  if (cost === undefined) return undefined;
  const details: Record<string, number> = {};
  if (cost.input !== undefined) details.input = cost.input;
  if (cost.output !== undefined) details.output = cost.output;
  if (cost.cacheRead !== undefined) details.cache_read_input_tokens = cost.cacheRead;
  if (cost.cacheWrite !== undefined) details.cache_creation_input_tokens = cost.cacheWrite;
  if (cost.total !== undefined) details.total = cost.total;
  return Object.keys(details).length === 0 ? undefined : details;
}

function modelCallStatus(call: PiModelCall): Record<string, string> {
  const message = call.errorMessage ?? call.stopReason;
  const failed =
    call.errorMessage !== undefined || call.stopReason === 'error' || call.stopReason === 'aborted';
  if (!failed) return {};
  return message === undefined ? {level: 'ERROR'} : {level: 'ERROR', statusMessage: message};
}

function recordModelCall({
  call,
  index,
  parentSpanContext,
}: {
  call: PiModelCall;
  index: number;
  parentSpanContext: SpanContext;
}): void {
  const usage = usageDetails(call.usage);
  const cost = costDetails(call.usage);
  const generation = startObservation(
    `model call ${index + 1}`,
    {
      input: call.input,
      output: call.output,
      ...(call.model === undefined ? {} : {model: call.model}),
      ...(usage === undefined ? {} : {usageDetails: usage}),
      ...(cost === undefined ? {} : {costDetails: cost}),
      metadata: {provider: call.provider, api: call.api, stop_reason: call.stopReason},
      ...modelCallStatus(call),
    },
    {
      asType: 'generation',
      startTime: call.startTime,
      parentSpanContext,
    },
  );
  generation.end(call.endTime);
}

function toolStatus(execution: PiToolExecution): Record<string, string> {
  if (execution.isError) return {level: 'ERROR'};
  if (execution.result === undefined) {
    return {level: 'WARNING', statusMessage: 'The session ended before a result.'};
  }
  return {};
}

function recordToolExecution({
  execution,
  parentSpanContext,
}: {
  execution: PiToolExecution;
  parentSpanContext: SpanContext;
}): void {
  const tool = startObservation(
    `Tool: ${execution.name}`,
    {
      input: execution.arguments,
      ...(execution.result === undefined ? {} : {output: execution.result}),
      metadata: {tool_call_id: execution.id},
      ...toolStatus(execution),
    },
    {
      asType: 'tool',
      startTime: execution.startTime,
      parentSpanContext,
    },
  );
  tool.end(execution.endTime);
}

export interface RecordPiTranscriptOptions {
  /** The workflow step the session belongs to. */
  step: string;
  jsonl: string;
}

export interface PiTranscriptExport {
  generations: number;
  tools: number;
}

/**
 * Records a pi session as an agent observation for the step, holding one generation per model call
 * and one tool observation per tool call. It nests under the active observation, and the raw JSONL
 * rides on the step observation as media. Callers should treat a non-empty session with no
 * generations as a format mismatch.
 */
export function recordPiTranscript(options: RecordPiTranscriptOptions): PiTranscriptExport {
  const transcript = parsePiTranscript(options.jsonl);
  const firstPrompt = transcript.modelCalls[0]?.input.find((message) => message.role === 'user');
  const stepSpan = startObservation(
    options.step,
    {
      input: firstPrompt?.content,
      metadata: {
        harness: 'pi',
        model_calls: transcript.modelCalls.length,
        tool_calls: transcript.toolExecutions.length,
        skipped_lines: transcript.skippedLines,
      },
    },
    {
      asType: 'agent',
      ...(transcript.startTime === undefined ? {} : {startTime: transcript.startTime}),
    },
  );
  const parentSpanContext = stepSpan.otelSpan.spanContext();

  transcript.modelCalls.forEach((call, index) => {
    recordModelCall({call, index, parentSpanContext});
  });
  for (const execution of transcript.toolExecutions) {
    recordToolExecution({execution, parentSpanContext});
  }

  stepSpan.update({
    output: {transcript: base64DataUri({contentType: 'application/x-ndjson', text: options.jsonl})},
  });
  stepSpan.end(transcript.endTime);
  return {generations: transcript.modelCalls.length, tools: transcript.toolExecutions.length};
}
