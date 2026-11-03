import type {SessionViewRow} from '@shipfox/client-logs';
import type {ConversationItem, TurnNotice} from '#core/conversation.js';

export const TURN_ID = '22222222-2222-4222-8222-222222222222';
export const OLD_TURN_ID = '33333333-3333-4333-8333-333333333333';

export const itemId = (seq: number) => `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;

export function rowsItem(params: {
  seq: number | null;
  rows: SessionViewRow[];
  turnId?: string | null;
  id?: string;
}): ConversationItem {
  return {
    id: params.id ?? itemId(params.seq ?? 999),
    seq: params.seq,
    turnId: params.turnId ?? null,
    clientMessageId: null,
    content: {type: 'rows', rows: params.rows},
    createdAt: '2026-11-02T10:00:00.000Z',
  };
}

export function userItem(seq: number | null, text: string, id?: string): ConversationItem {
  return rowsItem({
    seq,
    ...(id ? {id} : {}),
    rows: [
      {
        kind: 'message',
        timestamp: 1,
        role: 'user',
        label: 'user',
        meta: [],
        text,
        terminalFailure: false,
      },
    ],
  });
}

export function agentRow(text: string, stop?: string): SessionViewRow {
  return {
    kind: 'message',
    timestamp: 2,
    role: 'assistant',
    label: 'assistant',
    meta: stop ? [{label: 'stop', value: stop}] : [],
    text,
    terminalFailure: stop === 'aborted',
  };
}

export function toolCall(id: string, name: string, input = '{}'): SessionViewRow {
  return {kind: 'tool-call', timestamp: 3, id, name, input};
}

export function toolResult(toolCallId: string, toolName: string, isError = false): SessionViewRow {
  return {kind: 'tool-result', timestamp: 4, toolCallId, toolName, output: '{}', isError};
}

export function noticeItem(seq: number, notice: TurnNotice): ConversationItem {
  return {
    id: itemId(seq),
    seq,
    turnId: null,
    clientMessageId: null,
    content: {type: 'turn_notice', notice},
    createdAt: '2026-11-02T10:00:00.000Z',
  };
}
