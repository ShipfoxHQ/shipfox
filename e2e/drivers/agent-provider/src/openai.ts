import type {FakeOpenAiResponse} from './scripts.js';

const fakeCreatedAt = 1783344000;

export interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: OpenAiChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export type OpenAiChatCompletionChoice =
  | {
      index: 0;
      message: {
        role: 'assistant';
        content: string;
        tool_calls: [
          {
            id: string;
            type: 'function';
            function: {
              name: string;
              arguments: string;
            };
          },
        ];
      };
      finish_reason: 'tool_calls';
    }
  | {
      index: 0;
      message: {
        role: 'assistant';
        content: string;
      };
      finish_reason: 'stop';
    };

export interface OpenAiChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: OpenAiChatCompletionChunkChoice[];
}

export type OpenAiChatCompletionChunkChoice =
  | {
      index: 0;
      delta: {
        role: 'assistant';
        content: string;
        tool_calls: [
          {
            index: 0;
            id: string;
            type: 'function';
            function: {
              name: string;
              arguments: string;
            };
          },
        ];
      };
      finish_reason: null;
    }
  | {
      index: 0;
      delta: {
        role: 'assistant';
        content: string;
      };
      finish_reason: null;
    }
  | {
      index: 0;
      delta: Record<string, never>;
      finish_reason: 'tool_calls' | 'stop';
    };

export interface OpenAiErrorBody {
  error: {
    message: string;
    type: string;
  };
}

export interface OpenAiModelList {
  object: 'list';
  data: OpenAiModel[];
}

export interface OpenAiModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export function buildChatCompletion(params: {
  model: string;
  response: Exclude<FakeOpenAiResponse, {kind: 'error'}>;
  responseIndex: number;
  scriptId: string;
}): OpenAiChatCompletion {
  const message =
    params.response.kind === 'tool_call'
      ? {
          role: 'assistant' as const,
          content: params.response.content ?? '',
          tool_calls: [
            {
              id: `call_fake_${params.responseIndex + 1}`,
              type: 'function' as const,
              function: {
                name: params.response.toolName,
                arguments: JSON.stringify(params.response.arguments),
              },
            },
          ],
        }
      : {
          role: 'assistant' as const,
          content: params.response.content,
        };

  return {
    id: `chatcmpl-fake-${params.scriptId}-${params.responseIndex}`,
    object: 'chat.completion',
    created: fakeCreatedAt,
    model: params.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: params.response.kind === 'tool_call' ? 'tool_calls' : 'stop',
      } as OpenAiChatCompletionChoice,
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  };
}

export function buildChatCompletionChunks(
  completion: OpenAiChatCompletion,
): OpenAiChatCompletionChunk[] {
  const base = {
    id: completion.id,
    object: 'chat.completion.chunk' as const,
    created: completion.created,
    model: completion.model,
  };
  const choice = completion.choices[0];
  if (choice === undefined) {
    throw new Error(`Chat completion ${completion.id} has no choices.`);
  }

  if ('tool_calls' in choice.message) {
    const toolCalls = choice.message.tool_calls.map((toolCall) => ({
      index: 0 as const,
      ...toolCall,
    })) as [
      {
        index: 0;
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      },
    ];

    return [
      {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: choice.message.content,
              tool_calls: toolCalls,
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...base,
        choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}],
      },
    ];
  }

  return [
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: choice.message.content,
          },
          finish_reason: null,
        },
      ],
    },
    {
      ...base,
      choices: [{index: 0, delta: {}, finish_reason: 'stop'}],
    },
  ];
}

export function buildOpenAiError(type: string, message: string): OpenAiErrorBody {
  return {error: {message, type}};
}

export function buildOpenAiModelList(model: string): OpenAiModelList {
  return {
    object: 'list',
    data: [
      {
        id: model,
        object: 'model',
        created: fakeCreatedAt,
        owned_by: 'shipfox-e2e',
      },
    ],
  };
}
