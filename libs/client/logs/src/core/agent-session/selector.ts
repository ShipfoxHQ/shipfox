import type {
  LogRecord,
  SessionViewLifecycleRow,
  SessionViewMessageRow,
  SessionViewRawRow,
  SessionViewRow,
  SessionViewRowMeta,
  SessionViewThinkingRow,
  SessionViewToolCallRow,
  SessionViewToolResultRow,
} from '@shipfox/api-logs-dto';
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

export type AgentSessionRow = SessionViewRow;
export type AgentRowMeta = SessionViewRowMeta;
export type AgentMessageRow = SessionViewMessageRow;
export type AgentThinkingRow = SessionViewThinkingRow;
export type AgentToolCallRow = SessionViewToolCallRow;
export type AgentToolResultRow = SessionViewToolResultRow;
export type AgentLifecycleRow = SessionViewLifecycleRow;
export type AgentRawRow = SessionViewRawRow;

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
        kind: 'raw',
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
      return [
        lifecycleRow(
          record.ts,
          'Context compacted',
          compactionDetail(entry),
          'default',
          false,
          compactionMeta(entry),
        ),
      ];
    case 'branch_summary':
      return [
        messageRow(
          record.ts,
          'system',
          'branch summary',
          branchSummaryDetail(entry) ?? toJson(entry),
          false,
          branchSummaryMeta(entry),
        ),
      ];
    case 'custom':
      return [
        messageRow(
          record.ts,
          'custom',
          customEntryLabel('custom'),
          customEntryText(entry) ?? toJson(entry),
          false,
          customEntryMeta(entry),
        ),
      ];
    case 'custom_message':
      return [
        messageRow(
          record.ts,
          'custom',
          customEntryLabel('custom message'),
          customEntryText(entry) ?? toJson(entry),
          false,
          customEntryMeta(entry),
        ),
      ];
    case 'label':
      return [
        lifecycleRow(record.ts, 'Label', labelDetail(entry), 'default', false, labelMeta(entry)),
      ];
    default:
      return [
        {
          kind: 'raw',
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
    return [{kind: 'raw', timestamp, label: 'Unsupported message entry', raw}];
  }

  const message = parsedEntry.data.message;
  const role = normalizeRole(message);

  if (isToolResultMessage(message)) return [toolResultRow(timestamp, message)];

  if (role === 'assistant') return expandAssistantMessage(timestamp, message);

  if (role === 'bash-execution') {
    return [
      messageRow(
        timestamp,
        role,
        'bash execution',
        bashExecutionText(message),
        isTerminalStop(message),
        bashExecutionMeta(message),
      ),
    ];
  }
  if (role === 'branch-summary') {
    return [
      messageRow(
        timestamp,
        role,
        'branch summary',
        branchSummaryDetail(message) ?? toJson(message),
        isTerminalStop(message),
        branchSummaryMeta(message),
      ),
    ];
  }
  if (role === 'compaction-summary') {
    return [
      messageRow(
        timestamp,
        role,
        'compaction summary',
        compactionDetail(message) ?? toJson(message),
        isTerminalStop(message),
        compactionMeta(message),
      ),
    ];
  }
  if (role === 'custom') {
    return [
      messageRow(
        timestamp,
        role,
        customEntryLabel('custom'),
        customEntryText(message) ?? toJson(message),
        isTerminalStop(message),
        customEntryMeta(message),
      ),
    ];
  }

  const text = messageText(message);
  return [
    messageRow(
      timestamp,
      role,
      roleLabel(role),
      text || toJson(message),
      isTerminalStop(message),
      messageMeta(message),
    ),
  ];
}

function expandAssistantMessage(
  timestamp: number,
  message: AgentMessage,
): readonly AgentSessionRow[] {
  const blocks = asContentBlocks(message.content);
  const terminalFailure = isTerminalStop(message);
  const meta = assistantMeta(message);
  if (blocks.length === 0) {
    const text = messageText(message);
    return [
      messageRow(
        timestamp,
        'assistant',
        'assistant',
        text || terminalStopDetail(message) || toJson(message),
        terminalFailure,
        meta,
      ),
    ];
  }

  const rows: AgentSessionRow[] = [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const pushTextParts = () => {
    if (textParts.length === 0) return;
    rows.push(
      messageRow(
        timestamp,
        'assistant',
        'assistant',
        textParts.join('\n\n'),
        terminalFailure,
        meta,
      ),
    );
    textParts.length = 0;
  };
  const pushThinkingParts = () => {
    if (thinkingParts.length === 0) return;
    rows.push({kind: 'thinking', timestamp, text: thinkingParts.join('\n\n')});
    thinkingParts.length = 0;
  };

  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      pushTextParts();
      pushThinkingParts();
      rows.push(toolCallRow(timestamp, block));
      continue;
    }

    if (isThinkingBlock(block)) {
      pushTextParts();
      const text = blockText(block);
      if (text) thinkingParts.push(text);
      continue;
    }

    pushThinkingParts();
    const text = blockText(block);
    if (text) textParts.push(text);
  }

  pushTextParts();
  pushThinkingParts();
  if (terminalFailure && !rows.some((row) => row.kind === 'message' && row.terminalFailure)) {
    rows.push(
      messageRow(
        timestamp,
        'assistant',
        'assistant',
        terminalStopDetail(message) || toJson(message),
        true,
        meta,
      ),
    );
  }
  if (rows.length === 0)
    rows.push(
      messageRow(timestamp, 'assistant', 'assistant', toJson(message), terminalFailure, meta),
    );

  return rows;
}

function messageRow(
  timestamp: number,
  role: string,
  label: string,
  text: string,
  terminalFailure: boolean,
  meta: readonly AgentRowMeta[] = [],
): AgentMessageRow {
  return {kind: 'message', timestamp, role, label, meta, text, terminalFailure};
}

function lifecycleRow(
  timestamp: number,
  label: string,
  detail: string | null,
  tone: AgentLifecycleRow['tone'],
  terminalFailure: boolean,
  meta: readonly AgentRowMeta[] = [],
): AgentLifecycleRow {
  return {kind: 'lifecycle', timestamp, label, detail, meta, tone, terminalFailure};
}

function toolCallRow(timestamp: number, block: ContentBlock): AgentToolCallRow {
  const id = stringField(block, 'id') ?? stringField(block, 'toolCallId') ?? null;
  const name = stringField(block, 'name') ?? stringField(block, 'toolName') ?? 'tool';
  const args = field(block, 'arguments') ?? field(block, 'input') ?? field(block, 'args') ?? {};

  return {kind: 'tool-call', timestamp, id, name, input: stringifyValue(args)};
}

function toolResultRow(timestamp: number, message: AgentMessage): AgentToolResultRow {
  const output = messageText(message) || stringifyValue(message.content ?? '');

  return {
    kind: 'tool-result',
    timestamp,
    toolCallId: message.toolCallId ?? null,
    toolName: message.toolName ?? 'tool',
    output,
    isError: message.isError === true,
  };
}

function isToolResultMessage(message: AgentMessage): boolean {
  const role = normalizeRole(message);
  return typeof message.toolCallId === 'string' || role === 'tool' || role === 'tool-result';
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
  if (stringField(block, 'type') === 'image') return imagePlaceholder(block);

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

function assistantMeta(message: AgentMessage): readonly AgentRowMeta[] {
  return [
    providerModelMeta(message),
    metaItem('api', stringField(message, 'api'), false),
    usageMeta(message),
    costMeta(message),
    stopReasonMeta(message),
  ].filter(isMeta);
}

function messageMeta(message: AgentMessage): readonly AgentRowMeta[] {
  return [stopReasonMeta(message)].filter(isMeta);
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
  const version = numberField(entry, 'version');
  const id = stringField(entry, 'id') ?? stringField(entry, 'sessionId');
  const cwd = stringField(entry, 'cwd');
  return (
    [version == null ? null : `v${version}`, id, cwd].filter(Boolean).join(' · ') ||
    entryDetail(entry)
  );
}

function modelChangeDetail(entry: SessionEntry): string | null {
  const model =
    stringField(entry, 'model') ?? stringField(entry, 'to') ?? stringField(entry, 'modelId');
  const provider = stringField(entry, 'provider');
  return [model, provider].filter(Boolean).join(' · ') || entryDetail(entry);
}

function compactionDetail(entry: SessionEntry | AgentMessage): string | null {
  return stringField(entry, 'summary') ?? stringField(entry, 'message') ?? entryDetail(entry);
}

function compactionMeta(entry: SessionEntry | AgentMessage): readonly AgentRowMeta[] {
  const tokensBefore = numberField(entry, 'tokensBefore');
  return [
    tokensBefore == null ? null : metaItem('tokens before', formatCount(tokensBefore, 'token')),
  ].filter(isMeta);
}

function branchSummaryDetail(entry: SessionEntry | AgentMessage): string | null {
  return stringField(entry, 'summary') ?? stringField(entry, 'message') ?? entryDetail(entry);
}

function branchSummaryMeta(entry: SessionEntry | AgentMessage): readonly AgentRowMeta[] {
  const fromId = stringField(entry, 'fromId');
  return [fromId == null ? null : metaItem('from', fromId)].filter(isMeta);
}

function customEntryLabel(fallback: string): string {
  return fallback;
}

function customEntryMeta(entry: SessionEntry | AgentMessage): readonly AgentRowMeta[] {
  const display = field(entry, 'display');
  return [
    metaItem('type', stringField(entry, 'customType')),
    typeof display === 'boolean' ? metaItem('display', display ? 'on' : 'off') : null,
  ].filter(isMeta);
}

function customEntryText(entry: SessionEntry | AgentMessage): string | null {
  const text = messageText(entry);
  if (text) return text;

  const data = field(entry, 'data') ?? field(entry, 'details');
  return data === undefined ? entryDetail(entry) : stringifyValue(data);
}

function bashExecutionMeta(message: AgentMessage): readonly AgentRowMeta[] {
  const exitCode = field(message, 'exitCode');
  return [
    typeof exitCode === 'number' ? metaItem('exit', String(exitCode)) : null,
    booleanField(message, 'cancelled') ? metaItem('cancelled', 'yes') : null,
    booleanField(message, 'truncated') ? metaItem('truncated', 'yes') : null,
    booleanField(message, 'excludeFromContext') ? metaItem('context', 'excluded') : null,
    metaItem('full output', stringField(message, 'fullOutputPath'), false),
  ].filter(isMeta);
}

function labelDetail(entry: SessionEntry): string | null {
  return stringField(entry, 'label') ?? entryDetail(entry);
}

function labelMeta(entry: SessionEntry): readonly AgentRowMeta[] {
  const targetId = stringField(entry, 'targetId');
  return [targetId == null ? null : metaItem('target', targetId, false)].filter(isMeta);
}

function bashExecutionText(message: AgentMessage): string {
  const command = stringField(message, 'command');
  const output = stringField(message, 'output');

  return [`$ ${command ?? ''}`.trim(), output].filter(Boolean).join('\n') || toJson(message);
}

function providerModelMeta(message: AgentMessage): AgentRowMeta | null {
  const model = stringField(message, 'model') ?? stringField(message, 'modelId');
  const provider = stringField(message, 'provider');
  const value = [provider, model].filter(Boolean).join('/');
  return value ? metaItem('model', value) : null;
}

function usageMeta(message: AgentMessage): AgentRowMeta | null {
  const usage = asLooseObject(field(message, 'usage'));
  const totalTokens = numberField(usage, 'totalTokens');
  return totalTokens == null ? null : metaItem('tokens', formatCount(totalTokens, 'token'));
}

function costMeta(message: AgentMessage): AgentRowMeta | null {
  const usage = asLooseObject(field(message, 'usage'));
  const cost = asLooseObject(field(usage, 'cost'));
  const total = numberField(cost, 'total');
  return total == null ? null : metaItem('cost', `$${total.toFixed(total < 0.01 ? 4 : 2)}`);
}

function stopReasonMeta(message: AgentMessage): AgentRowMeta | null {
  const stopReason = stringField(message, 'stopReason');
  return stopReason == null ? null : metaItem('stop', stopReason);
}

function formatCount(value: number, unit: string): string {
  return `${new Intl.NumberFormat('en-US', {maximumFractionDigits: 1, notation: value >= 10000 ? 'compact' : 'standard'}).format(value)} ${unit}${value === 1 ? '' : 's'}`;
}

function metaItem(
  label: string,
  value: string | null | undefined,
  inline = true,
): AgentRowMeta | null {
  if (value == null || value.length === 0) return null;
  return inline ? {label, value} : {label, value, inline};
}

function isMeta(value: AgentRowMeta | null | undefined): value is AgentRowMeta {
  return value != null;
}

function imagePlaceholder(block: ContentBlock): string {
  const mimeType = stringField(block, 'mimeType');
  return mimeType == null ? '[image]' : `[${mimeType} image]`;
}

function entryDetail(entry: SessionEntry | AgentMessage): string | null {
  const detail =
    stringField(entry, 'message') ??
    stringField(entry, 'text') ??
    stringField(entry, 'content') ??
    stringField(entry, 'summary') ??
    stringField(entry, 'label') ??
    stringField(entry, 'thinkingLevel') ??
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

function numberField(value: unknown, key: string): number | undefined {
  const fieldValue = field(value, key);
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : undefined;
}

function booleanField(value: unknown, key: string): boolean {
  return field(value, key) === true;
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return toJson(value);
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}
