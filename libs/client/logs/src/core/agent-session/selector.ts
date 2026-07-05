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

export type AgentSessionLogRecord = Extract<LogRecord, {type: 'agent_session'}>;

export type AgentSessionRow = SessionViewRow;
export type AgentRowMeta = SessionViewRowMeta;
export type AgentMessageRow = SessionViewMessageRow;
export type AgentThinkingRow = SessionViewThinkingRow;
export type AgentToolCallRow = SessionViewToolCallRow;
export type AgentToolResultRow = SessionViewToolResultRow;
export type AgentLifecycleRow = SessionViewLifecycleRow;
export type AgentRawRow = SessionViewRawRow;

export function expandSessionRecord(record: AgentSessionLogRecord): readonly AgentSessionRow[] {
  return [record.row];
}
