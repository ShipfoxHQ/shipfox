import type {LogRecord} from '@shipfox/api-logs-dto';
import {
  type AgentMessage,
  asContentBlocks,
  asLooseObject,
  type ContentBlock,
  parseSessionEntry,
  type SessionEntry,
  sessionMessageEntrySchema,
} from './entry-schema.js';

const MESSAGE_SUFFIX = /Message$/;
const CAMEL_CASE_BOUNDARY = /([a-z])([A-Z])/g;

export type AgentSessionLogRecord = Extract<LogRecord, {type: 'agent_session'}>;

export type AgentSessionRow =
  | AgentMessageRow
  | AgentThinkingRow
  | AgentToolCallRow
  | AgentToolResultRow
  | AgentLifecycleRow
  | AgentFallbackRow;

export interface AgentSessionRowBase {
  timestamp: number;
}

export interface AgentMessageRow extends AgentSessionRowBase {
  kind: 'message';
  role: string;
  label: string;
  text: string;
  terminalFailure: boolean;
}

export interface AgentThinkingRow extends AgentSessionRowBase {
  kind: 'thinking';
  text: string;
}

export interface AgentToolCallRow extends AgentSessionRowBase {
  kind: 'tool-call';
  id: string | null;
  name: string;
  input: string;
}

export interface AgentToolResultRow extends AgentSessionRowBase {
  kind: 'tool-result';
  toolCallId: string | null;
  toolName: string;
  output: string;
  isError: boolean;
}

export interface AgentLifecycleRow extends AgentSessionRowBase {
  kind: 'lifecycle';
  label: string;
  detail: string | null;
  tone: 'default' | 'warning' | 'error';
  terminalFailure: boolean;
}

export interface AgentFallbackRow extends AgentSessionRowBase {
  kind: 'fallback';
  label: string;
  raw: string;
}

const rowCache = new WeakMap<AgentSessionLogRecord, readonly AgentSessionRow[]>();

export function expandSessionRecord(record: AgentSessionLogRecord): readonly AgentSessionRow[] {
  const cached = rowCache.get(record);
  if (cached) return cached;

  const rows = expandSessionRecordUncached(record);
  rowCache.set(record, rows);
  return rows;
}

function expandSessionRecordUncached(record: AgentSessionLogRecord): readonly AgentSessionRow[] {
  const parsed = parseSessionEntry(record.data);
  if (!parsed.ok) {
    return [
      {
        kind: 'fallback',
        timestamp: record.ts,
        label: parsed.reason === 'invalid-json' ? 'Malformed session entry' : 'Unsupported entry',
        raw: record.data,
      },
    ];
  }

  const entry = parsed.entry;
  switch (entry.type) {
    case 'message':
      return expandMessageEntry(record.ts, entry, record.data);
    case 'session':
      return [lifecycleRow(record.ts, 'Session started', sessionDetail(entry), 'default', false)];
    case 'session_info':
      return [lifecycleRow(record.ts, 'Session info', entryDetail(entry), 'default', false)];
    case 'thinking_level_change':
      return [
        lifecycleRow(record.ts, 'Thinking level changed', entryDetail(entry), 'default', false),
      ];
    case 'model_change':
      return [lifecycleRow(record.ts, 'Model changed', modelChangeDetail(entry), 'default', false)];
    case 'compaction':
      return [lifecycleRow(record.ts, 'Context compacted', entryDetail(entry), 'default', false)];
    case 'branch_summary':
      return [
        messageRow(
          record.ts,
          'system',
          'branch summary',
          entryDetail(entry) ?? toJson(entry),
          false,
        ),
      ];
    case 'custom':
    case 'custom_message':
      return [
        messageRow(
          record.ts,
          'custom',
          entry.type.replace('_', ' '),
          entryDetail(entry) ?? toJson(entry),
          false,
        ),
      ];
    case 'label':
      return [lifecycleRow(record.ts, 'Label', entryDetail(entry), 'default', false)];
    default:
      return [
        {
          kind: 'fallback',
          timestamp: record.ts,
          label: `Unknown session entry: ${entry.type}`,
          raw: record.data,
        },
      ];
  }
}

function expandMessageEntry(
  timestamp: number,
  entry: SessionEntry,
  raw: string,
): readonly AgentSessionRow[] {
  const parsedEntry = sessionMessageEntrySchema.safeParse(entry);
  if (!parsedEntry.success) {
    return [{kind: 'fallback', timestamp, label: 'Unsupported message entry', raw}];
  }

  const message = parsedEntry.data.message;
  const role = normalizeRole(message);

  if (isToolResultMessage(message)) return [toolResultRow(timestamp, message)];

  if (role === 'assistant') return expandAssistantMessage(timestamp, message);

  const text = messageText(message);
  return [
    messageRow(timestamp, role, roleLabel(role), text || toJson(message), isTerminalStop(message)),
  ];
}

function expandAssistantMessage(
  timestamp: number,
  message: AgentMessage,
): readonly AgentSessionRow[] {
  const blocks = asContentBlocks(message.content);
  if (blocks.length === 0) {
    const text = messageText(message);
    return [
      messageRow(
        timestamp,
        'assistant',
        assistantLabel(message),
        text || terminalStopDetail(message) || toJson(message),
        isTerminalStop(message),
      ),
    ];
  }

  const rows: AgentSessionRow[] = [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];

  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      if (textParts.length > 0) {
        rows.push(
          messageRow(
            timestamp,
            'assistant',
            assistantLabel(message),
            textParts.join('\n\n'),
            isTerminalStop(message),
          ),
        );
        textParts.length = 0;
      }
      if (thinkingParts.length > 0) {
        rows.push({kind: 'thinking', timestamp, text: thinkingParts.join('\n\n')});
        thinkingParts.length = 0;
      }
      rows.push(toolCallRow(timestamp, block));
      continue;
    }

    if (isThinkingBlock(block)) {
      const text = blockText(block);
      if (text) thinkingParts.push(text);
      continue;
    }

    const text = blockText(block);
    if (text) textParts.push(text);
  }

  if (textParts.length > 0) {
    rows.push(
      messageRow(
        timestamp,
        'assistant',
        assistantLabel(message),
        textParts.join('\n\n'),
        isTerminalStop(message),
      ),
    );
  }
  if (thinkingParts.length > 0)
    rows.push({kind: 'thinking', timestamp, text: thinkingParts.join('\n\n')});
  if (rows.length === 0)
    rows.push(
      messageRow(
        timestamp,
        'assistant',
        assistantLabel(message),
        toJson(message),
        isTerminalStop(message),
      ),
    );

  return rows;
}

function messageRow(
  timestamp: number,
  role: string,
  label: string,
  text: string,
  terminalFailure: boolean,
): AgentMessageRow {
  return {kind: 'message', timestamp, role, label, text, terminalFailure};
}

function lifecycleRow(
  timestamp: number,
  label: string,
  detail: string | null,
  tone: AgentLifecycleRow['tone'],
  terminalFailure: boolean,
): AgentLifecycleRow {
  return {kind: 'lifecycle', timestamp, label, detail, tone, terminalFailure};
}

function toolCallRow(timestamp: number, block: ContentBlock): AgentToolCallRow {
  const id = stringField(block, 'id') ?? stringField(block, 'toolCallId') ?? null;
  const name = stringField(block, 'name') ?? stringField(block, 'toolName') ?? 'tool';
  const args = field(block, 'arguments') ?? field(block, 'input') ?? field(block, 'args') ?? {};

  return {kind: 'tool-call', timestamp, id, name, input: stringifyValue(args)};
}

function toolResultRow(timestamp: number, message: AgentMessage): AgentToolResultRow {
  return {
    kind: 'tool-result',
    timestamp,
    toolCallId: message.toolCallId ?? null,
    toolName: message.toolName ?? 'tool',
    output: stringifyValue(message.content ?? ''),
    isError: message.isError === true,
  };
}

function isToolResultMessage(message: AgentMessage): boolean {
  return typeof message.toolCallId === 'string' || normalizeRole(message) === 'tool';
}

function isToolCallBlock(block: ContentBlock): boolean {
  const type = stringField(block, 'type');
  return type === 'toolCall' || type === 'tool_call' || type === 'tool-call';
}

function isThinkingBlock(block: ContentBlock): boolean {
  const type = stringField(block, 'type');
  return type === 'thinking' || type === 'thought' || type === 'reasoning';
}

function blockText(block: ContentBlock): string {
  return (
    stringField(block, 'text') ??
    stringField(block, 'content') ??
    stringField(block, 'thinking') ??
    ''
  );
}

function messageText(message: AgentMessage): string {
  if (typeof message.content === 'string') return message.content;

  const blocks = asContentBlocks(message.content);
  if (blocks.length > 0) {
    return blocks
      .map((block) => blockText(block))
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

function normalizeRole(message: AgentMessage): string {
  const raw = message.role ?? message.type ?? 'message';
  return raw.replace(MESSAGE_SUFFIX, '').replace(CAMEL_CASE_BOUNDARY, '$1-$2').toLowerCase();
}

function roleLabel(role: string): string {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  return role.replaceAll('-', ' ');
}

function assistantLabel(message: AgentMessage): string {
  const parts = ['assistant'];
  if (message.model) parts.push(message.model);
  if (message.provider) parts.push(message.provider);
  return parts.join(' · ');
}

function isTerminalStop(message: AgentMessage): boolean {
  return (
    message.errorMessage != null ||
    message.stopReason === 'error' ||
    message.stopReason === 'aborted'
  );
}

function terminalStopDetail(message: AgentMessage): string | null {
  if (message.errorMessage) return message.errorMessage;
  if (message.stopReason === 'error') return 'Assistant stopped with an error.';
  if (message.stopReason === 'aborted') return 'Assistant run was aborted.';
  return null;
}

function sessionDetail(entry: SessionEntry): string | null {
  const id = stringField(entry, 'id') ?? stringField(entry, 'sessionId');
  const cwd = stringField(entry, 'cwd');
  return [id, cwd].filter(Boolean).join(' · ') || entryDetail(entry);
}

function modelChangeDetail(entry: SessionEntry): string | null {
  const model =
    stringField(entry, 'model') ?? stringField(entry, 'to') ?? stringField(entry, 'modelId');
  const provider = stringField(entry, 'provider');
  return [model, provider].filter(Boolean).join(' · ') || entryDetail(entry);
}

function entryDetail(entry: SessionEntry): string | null {
  const detail =
    stringField(entry, 'message') ??
    stringField(entry, 'text') ??
    stringField(entry, 'summary') ??
    stringField(entry, 'label') ??
    stringField(entry, 'level') ??
    stringField(entry, 'reason');
  if (detail) return detail;

  const value = field(entry, 'data') ?? field(entry, 'payload');
  if (value === undefined) return null;
  return stringifyValue(value);
}

function stringField(value: unknown, key: string): string | undefined {
  const object = asLooseObject(value);
  const fieldValue = object?.[key];
  return typeof fieldValue === 'string' && fieldValue.length > 0 ? fieldValue : undefined;
}

function field(value: unknown, key: string): unknown {
  const object = asLooseObject(value);
  return object?.[key];
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return toJson(value);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}
