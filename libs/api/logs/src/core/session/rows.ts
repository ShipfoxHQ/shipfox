import type {
  SessionViewLifecycleRow,
  SessionViewMessageRow,
  SessionViewRow,
  SessionViewRowMeta,
  SessionViewThinkingRow,
} from '@shipfox/api-logs-dto';
import type {AgentSessionRecord} from './session-record.js';

export function messageRow(
  timestamp: number,
  role: string,
  label: string,
  text: string,
  terminalFailure: boolean,
  meta: readonly SessionViewRowMeta[] = [],
): SessionViewMessageRow {
  return {kind: 'message', timestamp, role, label, meta, text, terminalFailure};
}

export function thinkingRow(timestamp: number, text: string): SessionViewThinkingRow {
  return {kind: 'thinking', timestamp, text};
}

export function lifecycleRow(
  timestamp: number,
  label: string,
  detail: string | null,
  tone: SessionViewLifecycleRow['tone'],
  terminalFailure: boolean,
  meta: readonly SessionViewRowMeta[] = [],
): SessionViewLifecycleRow {
  return {kind: 'lifecycle', timestamp, label, detail, meta, tone, terminalFailure};
}

export function rawRecordRow(record: AgentSessionRecord, label: string): SessionViewRow {
  return {kind: 'raw', timestamp: record.ts, label, raw: record.data};
}
