import type {ConversationItemDto} from '@shipfox/api-agent-dto';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {summarizeTurn} from './shippy-conversation.js';

function item(overrides: Partial<ConversationItemDto>): ConversationItemDto {
  return {
    id: crypto.randomUUID(),
    seq: 1,
    entry_type: 'message',
    turn_id: 'turn-1',
    author_user_id: null,
    client_message_id: null,
    content: null,
    created_at: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

const rows = (entries: unknown[]) =>
  ({type: 'rows', rows: entries}) as unknown as ConversationItemDto['content'];

describe('summarizeTurn', () => {
  it('collects the tool calls and the assistant text of one turn', () => {
    const items = [
      item({
        seq: 2,
        content: rows([
          {
            kind: 'message',
            role: 'user',
            label: 'User',
            meta: [],
            text: 'Why?',
            timestamp: 0,
            terminalFailure: false,
          },
        ]),
      }),
      item({
        seq: 3,
        content: rows([
          {
            kind: 'tool-call',
            id: 'call-1',
            name: 'get_step_logs',
            input: '{"run_id":"run-1"}',
            timestamp: 0,
          },
        ]),
      }),
      item({
        seq: 4,
        content: rows([
          {
            kind: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'get_step_logs',
            output: 'ENOSPC',
            isError: false,
            timestamp: 0,
          },
        ]),
      }),
      item({
        seq: 5,
        turn_id: 'turn-2',
        content: rows([
          {
            kind: 'message',
            role: 'assistant',
            label: 'Assistant',
            meta: [],
            text: 'Another turn.',
            timestamp: 0,
            terminalFailure: false,
          },
        ]),
      }),
      item({
        seq: 6,
        content: rows([
          {
            kind: 'message',
            role: 'assistant',
            label: 'Assistant',
            meta: [],
            text: 'Out of disk.',
            timestamp: 0,
            terminalFailure: false,
          },
          {kind: 'tool-call', id: 'call-2', name: 'search_docs', input: 'not json', timestamp: 0},
        ]),
      }),
    ];

    expect(
      summarizeTurn({
        items,
        turnId: 'turn-1',
        message: 'Why?',
        status: 'succeeded',
        failureCode: null,
      }),
    ).toEqual({
      message: 'Why?',
      status: 'succeeded',
      failure_code: null,
      reply: 'Out of disk.',
      tool_calls: [
        {name: 'get_step_logs', input: '{"run_id":"run-1"}'},
        {name: 'search_docs', input: 'not json'},
      ],
    });
  });

  it('reads a turn notice as a denied turn', () => {
    const items = [
      item({
        content: {
          type: 'turn_notice',
          turn_notice: {code: 'admission-denied', message: null, required_action: null},
        },
      }),
    ];

    expect(
      summarizeTurn({
        items,
        turnId: 'turn-1',
        message: 'Why?',
        status: 'succeeded',
        failureCode: null,
      }).status,
    ).toBe('denied');
  });
});
