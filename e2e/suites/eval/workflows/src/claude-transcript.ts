import {type StartObservationOptions, startObservation} from '@langfuse/tracing';
import {base64DataUri} from './media.js';

/**
 * Converts a Claude session transcript into Langfuse observations, following the logic of
 * Langfuse's Claude Code integration: one generation per model call, one tool span per tool call,
 * and one span per user turn.
 *
 * Two shapes are read. Claude Code's own session files carry a `timestamp` on every line and
 * split one model response over several lines that share a `message.id`. The Agent SDK message
 * stream has whole messages and no timestamps, so those observations inherit the last known time.
 */

const TOOL_RESULT_TYPE = 'tool_result';

export interface ClaudeUsage {
  input?: number;
  output?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ClaudeToolCall {
  id: string;
  name: string;
  input: unknown;
  start: Date;
  end: Date;
  /** Undefined when the transcript ends before the tool result arrives. */
  output?: unknown;
  isError: boolean;
}

export interface ClaudeGeneration {
  id: string;
  model?: string | undefined;
  start: Date;
  end: Date;
  /** What the model saw since its previous call: the user prompt or the tool results. */
  input: unknown[];
  text: string;
  thinking: string;
  stopReason?: string | undefined;
  usage: ClaudeUsage;
  tools: ClaudeToolCall[];
}

export interface ClaudeTurn {
  index: number;
  prompt: string | undefined;
  start: Date;
  end: Date;
  generations: ClaudeGeneration[];
}

export interface ClaudeTranscript {
  sessionId?: string | undefined;
  turns: ClaudeTurn[];
}

type JsonObject = Record<string, unknown>;
type SpanContext = NonNullable<StartObservationOptions['parentSpanContext']>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

function parseTime(value: unknown): Date | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time;
}

function contentBlocks(message: JsonObject): JsonObject[] {
  const {content} = message;
  if (typeof content === 'string') return [{type: 'text', text: content}];
  return Array.isArray(content) ? content.filter(isObject) : [];
}

/** A tool result is text blocks in the common case, which read better as one string. */
function toolResultOutput(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const blocks = content.filter(isObject);
  const isText = (block: JsonObject) => block.type === 'text' && typeof block.text === 'string';
  if (blocks.length === content.length && blocks.every(isText)) {
    return blocks.map((block) => block.text).join('\n');
  }
  return content;
}

function readUsage(value: unknown): ClaudeUsage {
  if (!isObject(value)) return {};
  const usage: ClaudeUsage = {};
  if (typeof value.input_tokens === 'number') usage.input = value.input_tokens;
  if (typeof value.output_tokens === 'number') usage.output = value.output_tokens;
  for (const key of ['cache_read_input_tokens', 'cache_creation_input_tokens'] as const) {
    if (typeof value[key] === 'number') usage[key] = value[key];
  }
  return usage;
}

interface ParseState {
  turns: ClaudeTurn[];
  generations: Map<string, ClaudeGeneration>;
  tools: Map<string, ClaudeToolCall>;
  /** Input the next model call will see, and when it became available. */
  pending: {items: unknown[]; at: Date};
}

function currentTurn(state: ParseState, at: Date): ClaudeTurn {
  const existing = state.turns.at(-1);
  if (existing) return existing;
  const turn: ClaudeTurn = {index: 1, prompt: undefined, start: at, end: at, generations: []};
  state.turns.push(turn);
  return turn;
}

function readUserEntry({
  state,
  message,
  at,
  isMeta,
}: {
  state: ParseState;
  message: JsonObject;
  at: Date;
  isMeta: boolean;
}): void {
  const texts: string[] = [];
  for (const block of contentBlocks(message)) {
    if (block.type === TOOL_RESULT_TYPE && typeof block.tool_use_id === 'string') {
      const tool = state.tools.get(block.tool_use_id);
      const output = toolResultOutput(block.content);
      if (tool) {
        tool.output = output;
        tool.isError = block.is_error === true;
        tool.end = at;
      }
      state.pending.items.push({tool_use_id: block.tool_use_id, content: output});
      state.pending.at = at;
    } else if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    }
  }
  // Meta entries are context the CLI injects, not something the user said.
  if (texts.length === 0 || isMeta) return;

  const prompt = texts.join('\n');
  state.turns.push({
    index: state.turns.length + 1,
    prompt,
    start: at,
    end: at,
    generations: [],
  });
  state.pending = {items: [prompt], at};
}

function startGeneration({
  state,
  id,
  at,
}: {
  state: ParseState;
  id: string;
  at: Date;
}): ClaudeGeneration {
  const generation: ClaudeGeneration = {
    id,
    start: state.pending.at < at ? state.pending.at : at,
    end: at,
    input: state.pending.items,
    text: '',
    thinking: '',
    usage: {},
    tools: [],
  };
  state.pending = {items: [], at};
  state.generations.set(id, generation);
  currentTurn(state, at).generations.push(generation);
  return generation;
}

function appendBlock({
  state,
  generation,
  block,
  at,
}: {
  state: ParseState;
  generation: ClaudeGeneration;
  block: JsonObject;
  at: Date;
}): void {
  const text = stringField(block, 'text');
  const thinking = stringField(block, 'thinking');
  const toolId = stringField(block, 'id');
  if (block.type === 'text' && text !== undefined) {
    generation.text += generation.text ? `\n${text}` : text;
  } else if (block.type === 'thinking' && thinking !== undefined) {
    generation.thinking += generation.thinking ? `\n${thinking}` : thinking;
  } else if (block.type === 'tool_use' && toolId !== undefined) {
    const tool: ClaudeToolCall = {
      id: toolId,
      name: stringField(block, 'name') ?? 'unknown',
      input: block.input,
      start: at,
      end: at,
      isError: false,
    };
    generation.tools.push(tool);
    state.tools.set(tool.id, tool);
  }
}

function readAssistantEntry({
  state,
  message,
  at,
  fallbackId,
}: {
  state: ParseState;
  message: JsonObject;
  at: Date;
  fallbackId: string;
}): void {
  const id = stringField(message, 'id') ?? fallbackId;
  const generation = state.generations.get(id) ?? startGeneration({state, id, at});

  // Later lines of one response repeat its usage with the final token counts, so the last wins.
  generation.end = at;
  generation.model = stringField(message, 'model') ?? generation.model;
  generation.stopReason = stringField(message, 'stop_reason') ?? generation.stopReason;
  if (isObject(message.usage)) generation.usage = readUsage(message.usage);

  for (const block of contentBlocks(message)) appendBlock({state, generation, block, at});
}

function readEntries(jsonl: string): JsonObject[] {
  const entries: JsonObject[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (isObject(entry)) entries.push(entry);
    } catch {
      // A truncated last line must not lose the rest of the transcript.
    }
  }
  return entries;
}

function turnEnd(turn: ClaudeTurn): Date {
  const times = turn.generations.flatMap((generation) => [
    generation.end,
    ...generation.tools.map((tool) => tool.end),
  ]);
  return new Date(Math.max(turn.end.getTime(), ...times.map((time) => time.getTime())));
}

/**
 * Reads the JSONL into turns. Lines that are not JSON or not conversation entries, such as
 * summaries, snapshots, and SDK system messages, are skipped.
 */
export function parseClaudeTranscript({
  jsonl,
  fallbackTime = new Date(),
}: {
  jsonl: string;
  /** The time for entries before the first timestamp, when the transcript has none. */
  fallbackTime?: Date | undefined;
}): ClaudeTranscript {
  const entries = readEntries(jsonl);

  // Entries without a timestamp take the last known one, and leading ones take the first known.
  const firstTimestamp = entries.map((entry) => parseTime(entry.timestamp)).find(Boolean);
  let lastKnown = firstTimestamp ?? fallbackTime;

  const state: ParseState = {
    turns: [],
    generations: new Map(),
    tools: new Map(),
    pending: {items: [], at: lastKnown},
  };
  let sessionId: string | undefined;

  for (const [index, entry] of entries.entries()) {
    const at = parseTime(entry.timestamp) ?? lastKnown;
    lastKnown = at;
    sessionId ??= stringField(entry, 'sessionId') ?? stringField(entry, 'session_id');
    if (!isObject(entry.message)) continue;

    if (entry.type === 'user') {
      readUserEntry({state, message: entry.message, at, isMeta: entry.isMeta === true});
    } else if (entry.type === 'assistant') {
      const fallbackId = stringField(entry, 'uuid') ?? `entry-${index}`;
      readAssistantEntry({state, message: entry.message, at, fallbackId});
    }
  }

  for (const turn of state.turns) turn.end = turnEnd(turn);
  return {sessionId, turns: state.turns};
}

export interface ClaudeTranscriptExport {
  turns: number;
  generations: number;
  tools: number;
}

function toUsageDetails(usage: ClaudeUsage): Record<string, number> {
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined));
}

function recordTool({
  tool,
  parentSpanContext,
}: {
  tool: ClaudeToolCall;
  parentSpanContext: SpanContext;
}): void {
  const unresolved = tool.output === undefined;
  let level: 'ERROR' | 'WARNING' | undefined;
  if (tool.isError) level = 'ERROR';
  if (unresolved) level = 'WARNING';
  startObservation(
    `Tool: ${tool.name}`,
    {
      input: tool.input,
      output: tool.output,
      metadata: {tool_use_id: tool.id},
      ...(level ? {level} : {}),
      ...(unresolved ? {statusMessage: 'No tool result in the transcript'} : {}),
    },
    {asType: 'tool', startTime: tool.start, parentSpanContext},
  ).end(tool.end);
}

function recordGeneration({
  generation,
  parentSpanContext,
}: {
  generation: ClaudeGeneration;
  parentSpanContext: SpanContext;
}): void {
  startObservation(
    'Claude response',
    {
      ...(generation.model ? {model: generation.model} : {}),
      input: generation.input,
      output: {
        text: generation.text,
        ...(generation.thinking ? {thinking: generation.thinking} : {}),
        ...(generation.tools.length > 0
          ? {tool_calls: generation.tools.map((tool) => ({id: tool.id, name: tool.name}))}
          : {}),
      },
      usageDetails: toUsageDetails(generation.usage),
      metadata: {message_id: generation.id, stop_reason: generation.stopReason},
    },
    {asType: 'generation', startTime: generation.start, parentSpanContext},
  ).end(generation.end);
  for (const tool of generation.tools) recordTool({tool, parentSpanContext});
}

/**
 * Records a transcript as observations under the active span, so a task that calls it inside an
 * experiment item lands in that item's trace. Timestamps come from the transcript, and the raw
 * JSONL rides along on the session span as media.
 */
export function exportClaudeTranscript({
  jsonl,
  name = 'Claude session',
  fallbackTime,
  metadata,
}: {
  jsonl: string;
  name?: string;
  fallbackTime?: Date | undefined;
  metadata?: Record<string, unknown>;
}): ClaudeTranscriptExport {
  const transcript = parseClaudeTranscript({jsonl, fallbackTime});
  const generations = transcript.turns.flatMap((turn) => turn.generations);
  const first = transcript.turns[0];

  const session = startObservation(
    name,
    {input: first?.prompt, metadata: {session_id: transcript.sessionId, ...metadata}},
    {asType: 'agent', startTime: first?.start ?? new Date()},
  );

  for (const turn of transcript.turns) {
    const turnSpan = startObservation(
      `Turn ${turn.index}`,
      {input: turn.prompt},
      {startTime: turn.start, parentSpanContext: session.otelSpan.spanContext()},
    );
    const parentSpanContext = turnSpan.otelSpan.spanContext();
    for (const generation of turn.generations) recordGeneration({generation, parentSpanContext});
    turnSpan.end(turn.end);
  }

  session.update({
    output: {
      final_message: generations.filter((generation) => generation.text).at(-1)?.text,
      // The span processor uploads base64 data URIs found in a span's output as media.
      media: {
        claude_transcript: base64DataUri({contentType: 'application/x-ndjson', text: jsonl}),
      },
    },
  });
  session.end(transcript.turns.at(-1)?.end);
  return {
    turns: transcript.turns.length,
    generations: generations.length,
    tools: generations.reduce((count, generation) => count + generation.tools.length, 0),
  };
}
