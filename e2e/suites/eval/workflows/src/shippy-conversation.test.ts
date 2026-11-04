import type {ConversationItemDto} from '@shipfox/api-agent-dto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {summarizeItems} from './shippy-conversation.js';

function item(params: {
  turnId: string | null;
  rows: Extract<ConversationItemDto['content'], {type: 'rows'}>['rows'];
}): ConversationItemDto {
  return {
    id: crypto.randomUUID(),
    seq: 1,
    entry_type: 'message',
    turn_id: params.turnId,
    author_user_id: null,
    client_message_id: null,
    content: {type: 'rows', rows: params.rows},
    created_at: '2026-11-04T10:00:00.000Z',
  };
}

function assistant(text: string) {
  return {
    timestamp: 0,
    kind: 'message' as const,
    role: 'assistant',
    label: 'assistant',
    meta: [],
    text,
    terminalFailure: false,
  };
}

describe('summarizeItems', () => {
  it('collects every tool call and the assistant text of the last turn only', () => {
    const items = [
      item({turnId: 'turn-1', rows: [assistant('An earlier answer.')]}),
      item({
        turnId: 'turn-2',
        rows: [
          {
            timestamp: 0,
            kind: 'tool-call',
            id: 'call-1',
            name: 'get_step_logs',
            input: '{"run_id":"r"}',
          },
        ],
      }),
      item({
        turnId: 'turn-2',
        rows: [
          {
            timestamp: 0,
            kind: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'get_step_logs',
            output: 'logs',
            isError: false,
          },
        ],
      }),
      item({turnId: 'turn-2', rows: [assistant('The certificate expired.')]}),
    ];

    const summary = summarizeItems({items, lastTurnId: 'turn-2'});

    expect(summary).toEqual({
      tool_calls: [{turn_id: 'turn-2', name: 'get_step_logs', input: '{"run_id":"r"}'}],
      tool_results: [{turn_id: 'turn-2', name: 'get_step_logs', is_error: false}],
      reply: 'The certificate expired.',
    });
  });
});
