import type {FakeOpenAiResponse} from './scripts.js';

export interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use';
  stop_sequence: null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export type AnthropicContentBlock =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

export type AnthropicStreamEvent =
  | {
      event: 'message_start';
      data: {
        type: 'message_start';
        message: Omit<AnthropicMessage, 'content' | 'stop_reason'> & {
          content: [];
          stop_reason: null;
        };
      };
    }
  | {
      event: 'content_block_start';
      data: {
        type: 'content_block_start';
        index: 0;
        content_block:
          | {type: 'text'; text: ''}
          | {type: 'tool_use'; id: string; name: string; input: Record<string, never>};
      };
    }
  | {
      event: 'content_block_delta';
      data:
        | {
            type: 'content_block_delta';
            index: 0;
            delta: {type: 'text_delta'; text: string};
          }
        | {
            type: 'content_block_delta';
            index: 0;
            delta: {type: 'input_json_delta'; partial_json: string};
          };
    }
  | {
      event: 'content_block_stop';
      data: {
        type: 'content_block_stop';
        index: 0;
      };
    }
  | {
      event: 'message_delta';
      data: {
        type: 'message_delta';
        delta: {
          stop_reason: 'end_turn' | 'tool_use';
          stop_sequence: null;
        };
        usage: {
          output_tokens: number;
        };
      };
    }
  | {
      event: 'message_stop';
      data: {
        type: 'message_stop';
      };
    };

export interface AnthropicErrorBody {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

export function buildAnthropicMessage(params: {
  model: string;
  response: Exclude<FakeOpenAiResponse, {kind: 'error'}>;
  responseIndex: number;
  scriptId: string;
}): AnthropicMessage {
  const content =
    params.response.kind === 'tool_call'
      ? [
          {
            type: 'tool_use' as const,
            id: `toolu_fake_${params.responseIndex + 1}`,
            name: params.response.toolName,
            input: params.response.arguments,
          },
        ]
      : [
          {
            type: 'text' as const,
            text: params.response.content,
          },
        ];

  return {
    id: `msg_fake_${params.scriptId}_${params.responseIndex}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content,
    stop_reason: params.response.kind === 'tool_call' ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
  };
}

export function buildAnthropicMessageStream(message: AnthropicMessage): AnthropicStreamEvent[] {
  const content = message.content[0];
  if (content === undefined) throw new Error(`Anthropic message ${message.id} has no content.`);

  const messageStart: AnthropicStreamEvent = {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: message.id,
        type: 'message',
        role: 'assistant',
        model: message.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: message.usage.input_tokens,
          output_tokens: 0,
        },
      },
    },
  };

  const stopEvents: AnthropicStreamEvent[] = [
    {
      event: 'content_block_stop',
      data: {type: 'content_block_stop', index: 0},
    },
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: {
          stop_reason: message.stop_reason,
          stop_sequence: null,
        },
        usage: {
          output_tokens: message.usage.output_tokens,
        },
      },
    },
    {
      event: 'message_stop',
      data: {type: 'message_stop'},
    },
  ];

  if (content.type === 'tool_use') {
    return [
      messageStart,
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: content.id,
            name: content.name,
            input: {},
          },
        },
      },
      {
        event: 'content_block_delta',
        data: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify(content.input),
          },
        },
      },
      ...stopEvents,
    ];
  }

  return [
    messageStart,
    {
      event: 'content_block_start',
      data: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: '',
        },
      },
    },
    {
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: content.text,
        },
      },
    },
    ...stopEvents,
  ];
}

export function buildAnthropicError(type: string, message: string): AnthropicErrorBody {
  return {type: 'error', error: {type, message}};
}
