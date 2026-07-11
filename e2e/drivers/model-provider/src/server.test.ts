import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {
  buildAnthropicMessageStream,
  buildChatCompletionChunks,
  createFakeOpenAiModelProviderServer,
  type FakeOpenAiModelProviderServer,
  type FakeOpenAiScript,
} from './index.js';

const adminToken = 'test-admin-token';
const sseDataPrefixRe = /^data: /u;

describe('buildChatCompletionChunks', () => {
  it('rejects completions without choices', () => {
    expect(() =>
      buildChatCompletionChunks({
        id: 'chatcmpl-empty',
        object: 'chat.completion',
        created: 1783344000,
        model: 'deterministic-output-agent',
        choices: [],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 0,
          total_tokens: 1,
        },
      }),
    ).toThrow('Chat completion chatcmpl-empty has no choices.');
  });
});

describe('buildAnthropicMessageStream', () => {
  it('rejects messages without content blocks', () => {
    expect(() =>
      buildAnthropicMessageStream({
        id: 'msg_empty',
        type: 'message',
        role: 'assistant',
        model: 'deterministic-output-agent',
        content: [],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 1,
          output_tokens: 0,
        },
      }),
    ).toThrow('Anthropic message msg_empty has no content.');
  });
});

describe('fake OpenAI model provider server', () => {
  let server: FakeOpenAiModelProviderServer;

  beforeEach(async () => {
    server = await createFakeOpenAiModelProviderServer({adminToken});
  });

  afterEach(async () => {
    await server.stop();
  });

  it('registers scripts behind the admin token', async () => {
    const script = fakeScript({id: 'registration'});

    const result = await postScript(server, script);

    expect(result.status).toBe(201);
    await expect(result.json()).resolves.toEqual({
      script_id: 'registration',
      model: 'deterministic-output-agent',
      model_provider_base_url: `${server.baseUrl}/scripts/registration/v1`,
      anthropic_model_provider_base_url: `${server.baseUrl}/scripts/registration`,
    });
  });

  it('rejects control requests without the admin token', async () => {
    const result = await fetch(`${server.baseUrl}/healthz`);

    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({
      error: {
        message: 'Missing or invalid admin token',
        type: 'unauthorized',
      },
    });
  });

  it.each([
    [
      'missing id',
      {model: 'deterministic-output-agent', responses: [{kind: 'message', content: 'done'}]},
      'Script id must be a non-empty string.',
    ],
    [
      'missing model',
      {id: 'invalid-script', responses: [{kind: 'message', content: 'done'}]},
      'Script model must be a non-empty string.',
    ],
    ['empty body', undefined, 'Request body is required.'],
  ])('rejects script registration with %s', async (_caseName, body, message) => {
    const result = await postRawScript(server, body);

    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({
      error: {
        message,
        type: 'bad_request',
      },
    });
  });

  it('advances the script cursor and returns OpenAI chat completion payloads', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'advance',
        responses: [
          {
            kind: 'tool_call',
            toolName: 'set_output',
            arguments: {key: 'message', value: 'qwen-tool-output-ok'},
            content: '',
          },
          {kind: 'message', content: 'done'},
        ],
      }),
    );

    const toolCallResult = await chatCompletion(server, 'advance', openAiRequest());
    const messageResult = await chatCompletion(
      server,
      'advance',
      openAiRequest({roles: ['system', 'user', 'assistant', 'tool']}),
    );

    expect(toolCallResult.status).toBe(200);
    await expect(toolCallResult.json()).resolves.toMatchObject({
      id: 'chatcmpl-fake-advance-0',
      object: 'chat.completion',
      created: 1783344000,
      model: 'deterministic-output-agent',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_fake_1',
                type: 'function',
                function: {
                  name: 'set_output',
                  arguments: '{"key":"message","value":"qwen-tool-output-ok"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    });
    expect(messageResult.status).toBe(200);
    await expect(messageResult.json()).resolves.toMatchObject({
      id: 'chatcmpl-fake-advance-1',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'done',
          },
          finish_reason: 'stop',
        },
      ],
    });
  });

  it('returns OpenAI chat completion chunks for streaming requests', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'streaming',
        responses: [
          {
            kind: 'tool_call',
            toolName: 'set_output',
            arguments: {key: 'message', value: 'qwen-tool-output-ok'},
            content: '',
          },
        ],
      }),
    );

    const result = await chatCompletion(server, 'streaming', {
      ...openAiRequest(),
      stream: true,
    });

    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(sseData(await result.text())).toEqual([
      expect.objectContaining({
        id: 'chatcmpl-fake-streaming-0',
        object: 'chat.completion.chunk',
        model: 'deterministic-output-agent',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_fake_1',
                  type: 'function',
                  function: {
                    name: 'set_output',
                    arguments: '{"key":"message","value":"qwen-tool-output-ok"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      expect.objectContaining({
        choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}],
      }),
      '[DONE]',
    ]);
  });

  it('lists the registered model through the OpenAI-compatible models endpoint', async () => {
    await postScript(server, fakeScript({id: 'models', model: 'deterministic-settings-agent'}));

    const result = await fetch(`${server.baseUrl}/scripts/models/v1/models`);

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({
      object: 'list',
      data: [
        {
          id: 'deterministic-settings-agent',
          object: 'model',
          created: 1783344000,
          owned_by: 'shipfox-e2e',
        },
      ],
    });
  });

  it('returns Anthropic messages payloads', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'anthropic-message',
        responses: [{kind: 'message', content: 'done'}],
        assertions: [{kind: 'model', equals: 'deterministic-output-agent'}],
      }),
    );

    const result = await anthropicMessage(server, 'anthropic-message', anthropicRequest());

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({
      id: 'msg_fake_anthropic-message_0',
      type: 'message',
      role: 'assistant',
      model: 'deterministic-output-agent',
      content: [{type: 'text', text: 'done'}],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
      },
    });
  });

  it('returns Anthropic message stream events for tool calls', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'anthropic-streaming-tool',
        responses: [
          {
            kind: 'tool_call',
            toolName: 'mcp__shipfox_outputs__set_output',
            arguments: {key: 'message', value: 'qwen-tool-output-ok'},
          },
        ],
        assertions: [{kind: 'tool_present', name: 'mcp__shipfox_outputs__set_output'}],
      }),
    );

    const result = await anthropicMessage(server, 'anthropic-streaming-tool', {
      ...anthropicRequest(),
      stream: true,
    });

    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(namedSseData(await result.text())).toEqual([
      {
        event: 'message_start',
        data: expect.objectContaining({
          type: 'message_start',
          message: expect.objectContaining({
            id: 'msg_fake_anthropic-streaming-tool_0',
            content: [],
            stop_reason: null,
          }),
        }),
      },
      {
        event: 'content_block_start',
        data: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_fake_1',
            name: 'mcp__shipfox_outputs__set_output',
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
            partial_json: '{"key":"message","value":"qwen-tool-output-ok"}',
          },
        },
      },
      {
        event: 'content_block_stop',
        data: {type: 'content_block_stop', index: 0},
      },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: {stop_reason: 'tool_use', stop_sequence: null},
          usage: {output_tokens: 1},
        },
      },
      {
        event: 'message_stop',
        data: {type: 'message_stop'},
      },
    ]);
  });

  it('does not advance the Anthropic script cursor for a different model', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'anthropic-small-fast',
        responses: [{kind: 'message', content: 'main-response'}],
      }),
    );

    const smallFastResult = await anthropicMessage(
      server,
      'anthropic-small-fast',
      anthropicRequest({model: 'claude-small-fast-sentinel'}),
    );
    const mainResult = await anthropicMessage(
      server,
      'anthropic-small-fast',
      anthropicRequest({model: 'deterministic-output-agent'}),
    );
    const requestsResult = await fetch(`${server.baseUrl}/scripts/anthropic-small-fast/requests`, {
      headers: adminHeaders(),
    });

    expect(smallFastResult.status).toBe(200);
    await expect(smallFastResult.json()).resolves.toMatchObject({
      model: 'claude-small-fast-sentinel',
      content: [{type: 'text', text: ''}],
      stop_reason: 'end_turn',
    });
    expect(mainResult.status).toBe(200);
    await expect(mainResult.json()).resolves.toMatchObject({
      model: 'deterministic-output-agent',
      content: [{type: 'text', text: 'main-response'}],
    });
    await expect(requestsResult.json()).resolves.toMatchObject({
      requests: [
        {
          index: 0,
          model: 'claude-small-fast-sentinel',
          served_response: 'message:non_consuming_model',
        },
        {
          index: 0,
          model: 'deterministic-output-agent',
          served_response: 'message',
        },
      ],
    });
  });

  it('returns a deterministic 409 when a script is exhausted', async () => {
    await postScript(
      server,
      fakeScript({id: 'exhausted', responses: [{kind: 'message', content: 'done'}]}),
    );
    await chatCompletion(server, 'exhausted', openAiRequest());

    const result = await chatCompletion(server, 'exhausted', openAiRequest());

    expect(result.status).toBe(409);
    await expect(result.json()).resolves.toEqual({
      error: {
        message: 'Fake model provider script exhausted: exhausted',
        type: 'script_exhausted',
      },
    });
  });

  it('returns a deterministic 422 when request assertions fail', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'assertions',
        assertions: [
          {kind: 'model', equals: 'deterministic-output-agent'},
          {kind: 'tool_present', name: 'set_output'},
        ],
      }),
    );

    const result = await chatCompletion(server, 'assertions', {
      model: 'wrong-model',
      messages: [{role: 'user'}],
      tools: [],
    });

    expect(result.status).toBe(422);
    await expect(result.json()).resolves.toEqual({
      error: {
        message: 'Expected model deterministic-output-agent but received wrong-model',
        type: 'script_assertion_failed',
      },
    });
  });

  it('can apply request assertions after a setup probe', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'deferred-assertions',
        assertions: [{kind: 'tool_present', name: 'set_output', minRequestIndex: 1}],
        responses: [
          {kind: 'message', content: 'probe-ok'},
          {kind: 'message', content: 'workflow-ok'},
        ],
      }),
    );

    const probeResult = await chatCompletion(server, 'deferred-assertions', {
      model: 'deterministic-output-agent',
      messages: [{role: 'user'}],
      tools: [],
    });
    const workflowResult = await chatCompletion(server, 'deferred-assertions', {
      model: 'deterministic-output-agent',
      messages: [{role: 'user'}],
      tools: [],
    });

    expect(probeResult.status).toBe(200);
    expect(workflowResult.status).toBe(422);
    await expect(workflowResult.json()).resolves.toEqual({
      error: {
        message: 'Expected tool set_output to be present',
        type: 'script_assertion_failed',
      },
    });
  });

  it.each([
    [
      'Anthropic tool-result blocks',
      anthropicMessage,
      anthropicRequest({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: [{type: 'text', text: 'linear-read-result-marker'}],
              },
            ],
          },
        ],
      }),
    ],
    [
      'OpenAI tool-result messages',
      chatCompletion,
      openAiRequest({
        messages: [{role: 'tool', content: 'linear-read-result-marker', tool_call_id: 'call_1'}],
      }),
    ],
  ])('matches content returned through %s', async (_shape, requestModel, request) => {
    await postScript(
      server,
      fakeScript({
        id: `message-content-${_shape}`,
        assertions: [{kind: 'message_content_includes', value: 'linear-read-result-marker'}],
        responses: [{kind: 'message', content: 'done'}],
      }),
    );

    const result = await requestModel(server, `message-content-${_shape}`, request);

    expect(result.status).toBe(200);
  });

  it('does not consume a scripted response when returned tool content is missing', async () => {
    await postScript(
      server,
      fakeScript({
        id: 'missing-message-content',
        assertions: [{kind: 'message_content_includes', value: 'linear-read-result-marker'}],
        responses: [{kind: 'message', content: 'done'}],
      }),
    );

    const rejected = await chatCompletion(
      server,
      'missing-message-content',
      openAiRequest({messages: [{role: 'tool', content: 'wrong marker', tool_call_id: 'call_1'}]}),
    );
    const accepted = await chatCompletion(
      server,
      'missing-message-content',
      openAiRequest({
        messages: [{role: 'tool', content: 'linear-read-result-marker', tool_call_id: 'call_1'}],
      }),
    );

    expect(rejected.status).toBe(422);
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({
      id: 'chatcmpl-fake-missing-message-content-0',
    });
  });

  it('records request diagnostics and clears them on reset', async () => {
    await postScript(
      server,
      fakeScript({id: 'diagnostics', responses: [{kind: 'message', content: 'done'}]}),
    );
    await chatCompletion(server, 'diagnostics', openAiRequest({roles: ['system', 'user']}));
    await chatCompletion(
      server,
      'diagnostics',
      openAiRequest({roles: ['system', 'user', 'assistant', 'tool']}),
    );

    const requestsResult = await fetch(`${server.baseUrl}/scripts/diagnostics/requests`, {
      headers: adminHeaders(),
    });

    expect(requestsResult.status).toBe(200);
    await expect(requestsResult.json()).resolves.toMatchObject({
      script_id: 'diagnostics',
      requests: [
        {
          index: 0,
          method: 'POST',
          path: '/scripts/diagnostics/v1/chat/completions',
          model: 'deterministic-output-agent',
          tools: ['set_output'],
          message_roles: ['system', 'user'],
          served_response: 'message',
          assertion_failures: [],
        },
        {
          index: 1,
          served_response: 'error:script_exhausted',
        },
      ],
    });

    const resetResult = await fetch(`${server.baseUrl}/scripts/diagnostics/reset`, {
      method: 'POST',
      headers: adminHeaders(),
    });
    const clearedResult = await fetch(`${server.baseUrl}/scripts/diagnostics/requests`, {
      headers: adminHeaders(),
    });

    expect(resetResult.status).toBe(204);
    await expect(clearedResult.json()).resolves.toEqual({
      script_id: 'diagnostics',
      requests: [],
    });
  });
});

function fakeScript(params: Partial<FakeOpenAiScript>): FakeOpenAiScript {
  return {
    id: params.id ?? 'script',
    model: params.model ?? 'deterministic-output-agent',
    responses: params.responses ?? [{kind: 'message', content: 'done'}],
    assertions: params.assertions,
  };
}

async function postScript(
  server: FakeOpenAiModelProviderServer,
  script: FakeOpenAiScript,
): Promise<Response> {
  return await postRawScript(server, script);
}

async function postRawScript(
  server: FakeOpenAiModelProviderServer,
  body: unknown | undefined,
): Promise<Response> {
  const request = {
    method: 'POST',
    headers: adminHeaders(),
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  };

  return await fetch(`${server.baseUrl}/scripts`, request);
}

async function chatCompletion(
  server: FakeOpenAiModelProviderServer,
  scriptId: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`${server.baseUrl}/scripts/${scriptId}/v1/chat/completions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function anthropicMessage(
  server: FakeOpenAiModelProviderServer,
  scriptId: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`${server.baseUrl}/scripts/${scriptId}/v1/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function adminHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
  };
}

function openAiRequest(
  params: {roles?: string[] | undefined; messages?: unknown[] | undefined} = {},
) {
  return {
    model: 'deterministic-output-agent',
    messages: params.messages ?? (params.roles ?? ['system', 'user']).map((role) => ({role})),
    tools: [
      {
        type: 'function',
        function: {
          name: 'set_output',
        },
      },
    ],
  };
}

function anthropicRequest(
  params: {model?: string | undefined; messages?: unknown[] | undefined} = {},
) {
  return {
    model: params.model ?? 'deterministic-output-agent',
    max_tokens: 128,
    messages: params.messages ?? [{role: 'user', content: 'Set the output'}],
    tools: [
      {
        name: 'mcp__shipfox_outputs__set_output',
        description: 'Set output',
        input_schema: {
          type: 'object',
          properties: {
            key: {type: 'string'},
            value: {type: 'string'},
          },
        },
      },
    ],
  };
}

function sseData(text: string): unknown[] {
  return text
    .trim()
    .split('\n\n')
    .map((chunk) => chunk.replace(sseDataPrefixRe, ''))
    .map((data) => (data === '[DONE]' ? data : JSON.parse(data)));
}

function namedSseData(text: string): Array<{event: string; data: unknown}> {
  return text
    .trim()
    .split('\n\n')
    .map((chunk) => {
      const lines = chunk.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length);
      const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length);
      if (event === undefined || data === undefined) {
        throw new Error(`Invalid named SSE chunk: ${chunk}`);
      }
      return {event, data: JSON.parse(data)};
    });
}
