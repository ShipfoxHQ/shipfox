import type {ToolCallResponseV1, ToolListResponseV1} from '@shipfox/actions/contract';
import {
  type ActionEndpoint,
  type ActionIntegrationGrant,
  type ActionToolRow,
  type ActionToolsUpstream,
  MAX_CONCURRENT_ACTION_TOOL_CALLS,
  type StartActionEndpointParams,
  startActionEndpoint,
} from '#core/action-endpoint.js';

const UUID_REGEX = /^[0-9a-f-]{36}$/;

const INTEGRATIONS: ActionIntegrationGrant[] = [
  {
    alias: 'slack',
    connectionSlug: 'team-slack',
    tools: [
      {
        id: 'read_thread',
        sensitivity: 'read',
        sensitive: false,
        result: 'json',
        inputSchema: {type: 'object', properties: {channel: {type: 'string'}}},
      },
      {
        id: 'post_message',
        sensitivity: 'write',
        sensitive: false,
        result: 'json',
        inputSchema: {type: 'object'},
      },
      {
        id: 'read_secret',
        sensitivity: 'read',
        sensitive: true,
        result: 'json',
        inputSchema: {type: 'object'},
      },
    ],
  },
  {
    alias: 'linear',
    connectionSlug: 'acme-linear',
    tools: [
      {
        id: 'issues',
        sensitivity: 'write',
        sensitive: false,
        result: 'json',
        inputSchema: {type: 'object'},
        methods: [
          {id: 'get', sensitivity: 'read', sensitive: false},
          {id: 'update', sensitivity: 'write', sensitive: false},
        ],
      },
      {
        id: 'download_file',
        sensitivity: 'read',
        sensitive: false,
        result: 'file',
        inputSchema: {type: 'object'},
      },
    ],
  },
];

interface PendingCall {
  params: {name: string; arguments: Record<string, unknown>};
  options: {signal: AbortSignal; timeout: number; headers: Record<string, string>};
  resolve: (result: {content?: unknown[]; structuredContent?: unknown; isError?: boolean}) => void;
}

function fakeUpstream() {
  const calls: PendingCall[] = [];
  const upstream: ActionToolsUpstream = {
    callTool: (params, options) =>
      new Promise((resolve, reject) => {
        calls.push({params, options, resolve});
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
      }),
  };
  return {upstream, calls};
}

describe('startActionEndpoint', () => {
  let endpoint: ActionEndpoint | undefined;
  let rows: ActionToolRow[];

  beforeEach(() => {
    rows = [];
  });

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
  });

  async function start(params: Partial<StartActionEndpointParams> = {}): Promise<ActionEndpoint> {
    endpoint = await startActionEndpoint({
      integrations: INTEGRATIONS,
      onToolRow: (row) => rows.push(row),
      now: () => 1000,
      ...params,
    });
    return endpoint;
  }

  function call(
    target: ActionEndpoint,
    body: unknown,
    init: {signal?: AbortSignal; token?: string} = {},
  ): Promise<Response> {
    return fetch(`${target.url}/v1/tools/call`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${init.token ?? target.token}`,
        'content-type': 'application/json',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...(init.signal ? {signal: init.signal} : {}),
    });
  }

  async function callJson(target: ActionEndpoint, body: unknown): Promise<ToolCallResponseV1> {
    return (await (await call(target, body)).json()) as ToolCallResponseV1;
  }

  describe('access', () => {
    it('rejects a request without the step token', async () => {
      const target = await start();

      const response = await call(target, {alias: 'slack', tool: 'read_thread'}, {token: 'wrong'});

      expect(response.status).toBe(401);
    });

    it('rejects a request that names another host', async () => {
      const target = await start();
      const {request} = await import('node:http');

      const status = await new Promise<number | undefined>((resolve, reject) => {
        request(
          `${target.url}/v1/tools`,
          {headers: {host: 'evil.example', authorization: `Bearer ${target.token}`}},
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        )
          .on('error', reject)
          .end();
      });

      expect(status).toBe(403);
    });

    it('rejects the token after teardown', async () => {
      const first = await startActionEndpoint({integrations: INTEGRATIONS});
      const oldToken = first.token;
      await first.close();
      const next = await start();

      await expect(call(first, {alias: 'slack', tool: 'read_thread'})).rejects.toThrow();
      const response = await call(next, {alias: 'slack', tool: 'read_thread'}, {token: oldToken});

      expect(response.status).toBe(401);
    });

    it('refuses a body above 2 MiB', async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});

      const response = await call(target, {
        alias: 'slack',
        tool: 'post_message',
        arguments: {text: 'x'.repeat(2 * 1024 * 1024)},
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: {code: 'request-too-large'},
      });
      expect(calls).toHaveLength(0);
    });
  });

  it('lists the granted tools per alias', async () => {
    const target = await start();

    const response = await fetch(`${target.url}/v1/tools`, {
      headers: {authorization: `Bearer ${target.token}`},
    });

    const body = (await response.json()) as ToolListResponseV1;
    expect(body.aliases.slack?.tools[0]).toEqual({
      tool: 'read_thread',
      input_schema: {type: 'object', properties: {channel: {type: 'string'}}},
      result: 'json',
    });
    expect(body.aliases.linear?.tools.map((tool) => [tool.tool, tool.result])).toEqual([
      ['issues', 'json'],
      ['download_file', 'file'],
    ]);
  });

  describe('forwarding', () => {
    it('calls the gateway tool named after the connection slug with the call id', async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});

      const pending = callJson(target, {
        alias: 'slack',
        tool: 'read_thread',
        arguments: {channel: 'C1'},
      });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]?.resolve({
        content: [{type: 'text', text: 'hello'}],
        structuredContent: {messages: 2},
      });
      const response = await pending;

      expect(calls[0]?.params).toEqual({
        name: 'team_slack__read_thread',
        arguments: {channel: 'C1'},
      });
      expect(response).toEqual({
        ok: true,
        call_id: expect.stringMatching(UUID_REGEX),
        result: {structured: {messages: 2}, content: [{type: 'text', text: 'hello'}]},
      });
      expect(calls[0]?.options.headers).toEqual({'x-shipfox-call-id': response.call_id});
    });

    it('splits family.method into the tool id and the method argument', async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});

      const pending = callJson(target, {
        alias: 'linear',
        tool: 'issues.get',
        arguments: {id: 'ENG-1'},
      });
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]?.resolve({content: []});
      await pending;

      expect(calls[0]?.params).toEqual({
        name: 'acme_linear__issues',
        arguments: {id: 'ENG-1', method: 'get'},
      });
    });

    it('turns a gateway tool error into a failure', async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});

      const pending = callJson(target, {alias: 'slack', tool: 'post_message', arguments: {}});
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      calls[0]?.resolve({
        isError: true,
        content: [{type: 'text', text: 'Slack is rate limiting'}],
        structuredContent: {code: 'rate-limited', retryAfterSeconds: 7},
      });

      expect(await pending).toEqual({
        ok: false,
        call_id: expect.stringMatching(UUID_REGEX),
        error: {
          code: 'rate-limited',
          message: 'Slack is rate limiting',
          retry_after_seconds: 7,
          outcome_unknown: false,
        },
      });
    });
  });

  describe('refusals', () => {
    it.each([
      ['an unbound alias', {alias: 'github', tool: 'read_thread'}, 'tool-not-granted'],
      ['an ungranted tool', {alias: 'slack', tool: 'delete_channel'}, 'tool-not-granted'],
      ['an ungranted method', {alias: 'linear', tool: 'issues.delete'}, 'tool-not-granted'],
      ['a file tool', {alias: 'linear', tool: 'download_file'}, 'tool-result-kind-mismatch'],
    ])('refuses %s before reaching the gateway', async (_label, body, code) => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});

      const response = await callJson(target, {...body, arguments: {}});

      expect(response).toMatchObject({ok: false, call_id: null, error: {code}});
      expect(calls).toHaveLength(0);
      expect(rows).toEqual([]);
    });
  });

  describe('cancellation', () => {
    it('aborts the gateway call when the step is cancelled and reports an unknown write', async () => {
      const {upstream, calls} = fakeUpstream();
      const step = new AbortController();
      const target = await start({upstream, signal: step.signal});

      const pending = callJson(target, {alias: 'slack', tool: 'post_message', arguments: {}});
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      step.abort();
      const response = await pending;
      const late = await callJson(target, {alias: 'slack', tool: 'read_thread', arguments: {}});

      expect(calls[0]?.options.signal.aborted).toBe(true);
      expect(response).toMatchObject({
        ok: false,
        error: {code: 'cancelled', outcome_unknown: true},
      });
      expect(late).toMatchObject({ok: false, call_id: null, error: {code: 'cancelled'}});
    });

    it('aborts the gateway call when the action disconnects', async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});
      const client = new AbortController();

      const pending = call(
        target,
        {alias: 'slack', tool: 'read_thread', arguments: {}},
        {signal: client.signal},
      );
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      client.abort();

      await expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(calls[0]?.options.signal.aborted).toBe(true));
      await vi.waitFor(() =>
        expect(rows.at(-1)).toMatchObject({kind: 'tool-result', isError: true}),
      );
    });

    it('times out a call that takes too long', async () => {
      const {upstream} = fakeUpstream();
      const target = await start({upstream, callTimeoutMs: 20});

      const response = await callJson(target, {alias: 'slack', tool: 'read_thread'});

      expect(response).toMatchObject({
        ok: false,
        error: {code: 'timeout', outcome_unknown: false},
      });
    });
  });

  describe('concurrency', () => {
    it('pairs tool rows by call id when calls finish out of order', async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});

      const first = callJson(target, {alias: 'slack', tool: 'read_thread', arguments: {n: 1}});
      const second = callJson(target, {alias: 'slack', tool: 'read_thread', arguments: {n: 2}});
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      const byArgument = (n: number) => calls.find((pending) => pending.params.arguments.n === n);
      byArgument(2)?.resolve({content: [{type: 'text', text: 'two'}]});
      const secondResponse = await second;
      byArgument(1)?.resolve({content: [{type: 'text', text: 'one'}]});
      const firstResponse = await first;

      const callRows = rows.filter((row) => row.kind === 'tool-call');
      const resultRows = rows.filter((row) => row.kind === 'tool-result');
      const inputFor = (callId: string) => callRows.find((row) => row.id === callId)?.input;
      const outputFor = (callId: string) =>
        resultRows.find((row) => row.toolCallId === callId)?.output;
      expect(inputFor(firstResponse.call_id ?? '')).toContain('"n": 1');
      expect(outputFor(firstResponse.call_id ?? '')).toContain('one');
      expect(inputFor(secondResponse.call_id ?? '')).toContain('"n": 2');
      expect(outputFor(secondResponse.call_id ?? '')).toContain('two');
      expect(resultRows.map((row) => row.toolCallId)).toEqual([
        secondResponse.call_id,
        firstResponse.call_id,
      ]);
    });

    it(`holds calls past ${MAX_CONCURRENT_ACTION_TOOL_CALLS} until one finishes`, async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream});

      const responses = Array.from({length: MAX_CONCURRENT_ACTION_TOOL_CALLS + 1}, (_, n) =>
        callJson(target, {alias: 'slack', tool: 'read_thread', arguments: {n}}),
      );
      await vi.waitFor(() => expect(calls).toHaveLength(MAX_CONCURRENT_ACTION_TOOL_CALLS));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toHaveLength(MAX_CONCURRENT_ACTION_TOOL_CALLS);
      calls[0]?.resolve({content: []});
      await vi.waitFor(() => expect(calls).toHaveLength(MAX_CONCURRENT_ACTION_TOOL_CALLS + 1));
      for (const pending of calls.slice(1)) pending.resolve({content: []});

      expect((await Promise.all(responses)).every((response) => response.ok)).toBe(true);
    });
  });

  it('redacts sensitive tool arguments and results in the rows', async () => {
    const {upstream, calls} = fakeUpstream();
    const target = await start({upstream});

    const pending = callJson(target, {alias: 'slack', tool: 'read_secret', arguments: {k: 'v'}});
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]?.resolve({content: [{type: 'text', text: 'classified'}]});
    const response = await pending;

    expect(rows).toEqual([
      {
        kind: 'tool-call',
        timestamp: 1000,
        id: response.call_id,
        name: 'team_slack__read_secret',
        input: '[sensitive tool arguments redacted]',
      },
      {
        kind: 'tool-result',
        timestamp: 1000,
        toolCallId: response.call_id,
        toolName: 'team_slack__read_secret',
        output: '[sensitive tool result redacted]',
        isError: false,
      },
    ]);
  });

  it('finishes the rows of in-flight calls before close resolves', async () => {
    const {upstream, calls} = fakeUpstream();
    const target = await start({upstream});

    const pending = call(target, {alias: 'slack', tool: 'read_thread', arguments: {}});
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await target.close();

    expect(rows.map((row) => row.kind)).toEqual(['tool-call', 'tool-result']);
    await pending.catch(() => undefined);
  });
});
