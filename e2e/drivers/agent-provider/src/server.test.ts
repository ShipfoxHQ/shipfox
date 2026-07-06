import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {
  createFakeOpenAiProviderServer,
  type FakeOpenAiProviderServer,
  type FakeOpenAiScript,
} from './index.js';

const adminToken = 'test-admin-token';
const sseDataPrefixRe = /^data: /u;

describe('fake OpenAI provider server', () => {
  let server: FakeOpenAiProviderServer;

  beforeEach(async () => {
    server = await createFakeOpenAiProviderServer({adminToken});
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
      provider_base_url: `${server.baseUrl}/scripts/registration/v1`,
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
        message: 'Fake provider script exhausted: exhausted',
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
  server: FakeOpenAiProviderServer,
  script: FakeOpenAiScript,
): Promise<Response> {
  return await postRawScript(server, script);
}

async function postRawScript(
  server: FakeOpenAiProviderServer,
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
  server: FakeOpenAiProviderServer,
  scriptId: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`${server.baseUrl}/scripts/${scriptId}/v1/chat/completions`, {
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

function openAiRequest(params: {roles?: string[] | undefined} = {}) {
  return {
    model: 'deterministic-output-agent',
    messages: (params.roles ?? ['system', 'user']).map((role) => ({role})),
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

function sseData(text: string): unknown[] {
  return text
    .trim()
    .split('\n\n')
    .map((chunk) => chunk.replace(sseDataPrefixRe, ''))
    .map((data) => (data === '[DONE]' ? data : JSON.parse(data)));
}
