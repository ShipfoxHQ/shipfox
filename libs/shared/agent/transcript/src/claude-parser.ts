import type {SessionViewRow} from '@shipfox/api-logs-dto';
import {z} from 'zod';
import {
  assistantRows,
  authStatusRow,
  PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES,
  rateLimitRow,
  resultRow,
  systemRow,
  userRows,
} from './claude/rows.js';
import {stringField} from './object.js';
import {rawRecordRow} from './rows.js';
import type {AgentSessionRecord} from './session-record.js';

const claudeMessageSchema = z
  .object({
    type: z.string().min(1),
  })
  .catchall(z.unknown());

export interface ClaudeParseContext {
  hasInit: boolean;
  sessionId: string | null;
  turn: number;
  pendingToolRows: SessionViewRow[];
}

export function createClaudeParseContext(
  pendingToolRows: readonly SessionViewRow[] = [],
  state: Pick<ClaudeParseContext, 'hasInit' | 'sessionId' | 'turn'> = {
    hasInit: false,
    sessionId: null,
    turn: 0,
  },
): ClaudeParseContext {
  return {...state, pendingToolRows: [...pendingToolRows]};
}

export function claudeInitSessionId(record: AgentSessionRecord): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(record.data);
  } catch {
    return undefined;
  }

  const parsed = claudeMessageSchema.safeParse(json);
  if (!parsed.success) return undefined;

  const message = parsed.data;
  if (
    message.type !== 'init' &&
    !(message.type === 'system' && stringField(message, 'subtype') === 'init')
  ) {
    return undefined;
  }

  return stringField(message, 'session_id') ?? stringField(message, 'sessionId');
}

export function parseClaudeSessionRecord(
  record: AgentSessionRecord,
  context: ClaudeParseContext = createClaudeParseContext(),
  isFinalResult = true,
): readonly SessionViewRow[] {
  let json: unknown;
  try {
    json = JSON.parse(record.data);
  } catch {
    return [rawRecordRow(record, 'Malformed session entry')];
  }

  const parsed = claudeMessageSchema.safeParse(json);
  if (!parsed.success) {
    return [rawRecordRow(record, 'Unsupported Claude message')];
  }

  const message = parsed.data;
  if (
    message.type === 'system' &&
    typeof message.subtype === 'string' &&
    PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES.has(message.subtype)
  ) {
    return [];
  }

  switch (message.type) {
    case 'system':
      return [systemRow(record.ts, message, context)];
    case 'init':
      return [systemRow(record.ts, message, context)];
    case 'tool_progress':
    case 'prompt_suggestion':
      // These messages describe an already-emitted tool call or an interactive client state.
      // They have no standalone row representation and must not look like parser failures.
      return [];
    case 'tool_use_summary':
      // Summaries are companion events for calls that are already in the stream.
      return [];
    case 'auth_status':
      return [authStatusRow(record.ts, message)];
    case 'rate_limit_event':
      return [rateLimitRow(record.ts, message)];
    case 'assistant':
      return assistantRows(record.ts, message);
    case 'user':
      return userRows(record.ts, message);
    case 'result':
      return [resultRow(record.ts, message, context.turn, isFinalResult)];
    default:
      return [rawRecordRow(record, `Unknown Claude message: ${message.type}`)];
  }
}
