import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {
  ToolCallResponseV1,
  ToolDownloadResponseV1,
  ToolListResponseV1,
} from '@shipfox/actions/contract';
import {LocalExecutionHost} from '@shipfox/runner-container';
import {
  ACTION_TOOL_DOWNLOAD_TIMEOUT_MS,
  type ActionEndpoint,
  type ActionIntegrationGrant,
  type ActionToolRow,
  type ActionToolsUpstream,
  MAX_CONCURRENT_ACTION_TOOL_CALLS,
  type StartActionEndpointParams,
  startActionEndpoint,
} from '#core/action-endpoint.js';

const UUID_REGEX = /^[0-9a-f-]{36}$/;
const HOSTED_PARTIAL_REGEX = /\.hosted\.txt\.[0-9a-f]{8}\.partial$/;

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

interface PendingDownload {
  request: {connectionSlug: string; tool: string; arguments: Record<string, unknown>};
  options: {signal: AbortSignal; headers: Record<string, string>};
  /** Pushes bytes to the action. */
  send: (text: string) => void;
  finish: () => void;
}

/** A gateway whose downloads stream only what the test sends. */
function fakeDownloadUpstream(headers: Record<string, string> = {}) {
  const downloads: PendingDownload[] = [];
  const upstream: ActionToolsUpstream = {
    callTool: () => Promise.reject(new Error('Not a call test.')),
    downloadFile: (request, options) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
        },
      });
      options.signal.addEventListener('abort', () => controller?.error(options.signal.reason), {
        once: true,
      });
      downloads.push({
        request,
        options,
        send: (text) => controller?.enqueue(new TextEncoder().encode(text)),
        finish: () => controller?.close(),
      });
      return Promise.resolve(
        new Response(body, {headers: {'content-type': 'application/pdf', ...headers}}),
      );
    },
  };
  return {upstream, downloads};
}

describe('startActionEndpoint', () => {
  let endpoint: ActionEndpoint | undefined;
  let rows: ActionToolRow[];
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    rows = [];
    root = await realpath(await mkdtemp(join(tmpdir(), 'action-endpoint-')));
    workspace = join(root, 'workspace');
    await mkdir(workspace);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await endpoint?.close();
    endpoint = undefined;
    await rm(root, {recursive: true, force: true});
  });

  async function start(params: Partial<StartActionEndpointParams> = {}): Promise<ActionEndpoint> {
    endpoint = await startActionEndpoint({
      integrations: INTEGRATIONS,
      cwd: workspace,
      workspace,
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

  function download(
    target: ActionEndpoint,
    body: Record<string, unknown>,
    init: {signal?: AbortSignal} = {},
  ): Promise<ToolDownloadResponseV1> {
    return fetch(`${target.url}/v1/tools/download`, {
      method: 'POST',
      headers: {authorization: `Bearer ${target.token}`, 'content-type': 'application/json'},
      body: JSON.stringify({alias: 'linear', tool: 'download_file', arguments: {}, ...body}),
      ...(init.signal ? {signal: init.signal} : {}),
    }).then((response) => response.json() as Promise<ToolDownloadResponseV1>);
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
      const first = await startActionEndpoint({
        integrations: INTEGRATIONS,
        cwd: workspace,
        workspace,
      });
      const oldToken = first.token;
      await first.close();
      const next = await start();

      // The next endpoint may reuse the freed port, so the stale URL is either refused or a 401.
      const stale = await call(first, {alias: 'slack', tool: 'read_thread'}).then(
        (response) => response.status,
        () => 'refused',
      );
      const response = await call(next, {alias: 'slack', tool: 'read_thread'}, {token: oldToken});

      expect([401, 'refused']).toContain(stale);
      expect(response.status).toBe(401);
    });

    it('refuses calls when the step was cancelled before the endpoint started', async () => {
      const {upstream, calls} = fakeUpstream();
      const target = await start({upstream, signal: AbortSignal.abort()});

      const response = await callJson(target, {alias: 'slack', tool: 'read_thread'});

      expect(response).toMatchObject({ok: false, call_id: null, error: {code: 'cancelled'}});
      expect(calls).toHaveLength(0);
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
      expect(rows.map((row) => (row.kind === 'tool-call' ? row.name : row.toolName))).toEqual([
        'linear__issues.get',
        'linear__issues.get',
      ]);
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

  describe('downloads', () => {
    it('streams the file into the workspace and returns its metadata', async () => {
      const {upstream, downloads} = fakeDownloadUpstream({
        'x-shipfox-filename': "UTF-8''Q3%20report.pdf",
      });
      const target = await start({upstream});

      const pending = download(target, {
        arguments: {url: 'https://uploads/x'},
        destination: 'files/',
      });
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      downloads[0]?.send('%PDF-');
      downloads[0]?.send('1.7');
      downloads[0]?.finish();
      const response = await pending;

      expect(response).toEqual({
        ok: true,
        call_id: expect.stringMatching(UUID_REGEX),
        file: {
          path: join('files', 'Q3 report.pdf'),
          bytes: 8,
          sha256: createHash('sha256').update('%PDF-1.7').digest('hex'),
          media_type: 'application/pdf',
          filename: 'Q3 report.pdf',
        },
      });
      expect(await readFile(join(workspace, 'files', 'Q3 report.pdf'), 'utf8')).toBe('%PDF-1.7');
      expect(downloads[0]?.request).toEqual({
        connectionSlug: 'acme-linear',
        tool: 'download_file',
        arguments: {url: 'https://uploads/x'},
      });
      expect(downloads[0]?.options.headers).toEqual({
        'x-shipfox-call-id': response.call_id,
        'x-shipfox-deadline': String(ACTION_TOOL_DOWNLOAD_TIMEOUT_MS),
      });
    });

    it('writes the file through the given host', async () => {
      const host = new LocalExecutionHost();
      const writeFile = vi.spyOn(host, 'writeFile');
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream, host});

      const pending = download(target, {destination: 'hosted.txt'});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      downloads[0]?.send('hosted bytes');
      downloads[0]?.finish();
      const response = await pending;

      expect(response.ok).toBe(true);
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringMatching(HOSTED_PARTIAL_REGEX),
        expect.anything(),
        expect.objectContaining({exclusive: true}),
      );
      expect(await readFile(join(workspace, 'hosted.txt'), 'utf8')).toBe('hosted bytes');
    });

    it('writes rows with the file metadata only', async () => {
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream});

      const pending = download(target, {destination: 'out.bin'});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      downloads[0]?.send('secret file bytes');
      downloads[0]?.finish();
      const response = await pending;

      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        kind: 'tool-result',
        toolCallId: response.call_id,
        toolName: 'linear__download_file',
        isError: false,
      });
      const output = rows[1]?.kind === 'tool-result' ? rows[1].output : '';
      expect(JSON.parse(output)).toMatchObject({path: 'out.bin', bytes: 17});
      expect(output).not.toContain('secret file bytes');
    });

    it('completes a slow three minute transfer', async () => {
      vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream});

      const pending = download(target, {destination: 'slow.txt'});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      for (let minute = 0; minute < 6; minute += 1) {
        downloads[0]?.send('chunk ');
        await vi.advanceTimersByTimeAsync(30_000);
      }
      downloads[0]?.finish();
      const response = await pending;

      expect(response).toMatchObject({ok: true, file: {path: 'slow.txt', bytes: 36}});
      expect(downloads[0]?.options.signal.aborted).toBe(false);
    });

    it('times out a transfer past its deadline and leaves no partial file', async () => {
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream, downloadTimeoutMs: 50});

      const pending = download(target, {destination: 'late.txt'});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      downloads[0]?.send('some');
      const response = await pending;

      expect(response).toMatchObject({ok: false, error: {code: 'timeout'}});
      expect(await readdir(workspace)).toEqual([]);
    });

    it('leaves no partial file when the step is cancelled mid-transfer', async () => {
      const {upstream, downloads} = fakeDownloadUpstream();
      const step = new AbortController();
      const target = await start({upstream, signal: step.signal});

      const pending = download(target, {destination: 'files/'});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      downloads[0]?.send('first bytes');
      await vi.waitFor(async () => expect(await readdir(join(workspace, 'files'))).toHaveLength(1));
      step.abort();
      const response = await pending;

      expect(downloads[0]?.options.signal.aborted).toBe(true);
      expect(response).toMatchObject({ok: false, error: {code: 'cancelled'}});
      expect(await readdir(join(workspace, 'files'))).toEqual([]);
    });

    it('leaves no partial file when the action disconnects', async () => {
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream});
      const client = new AbortController();

      const pending = download(target, {destination: 'files/'}, {signal: client.signal});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      downloads[0]?.send('first bytes');
      client.abort();

      await expect(pending).rejects.toThrow();
      await vi.waitFor(() =>
        expect(rows.at(-1)).toMatchObject({kind: 'tool-result', isError: true}),
      );
      expect(downloads[0]?.options.signal.aborted).toBe(true);
      expect(await readdir(join(workspace, 'files'))).toEqual([]);
    });

    it('refuses a destination outside the workspace before reaching the gateway', async () => {
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream});

      const response = await download(target, {destination: '../escape.txt'});

      expect(response).toMatchObject({
        ok: false,
        call_id: null,
        error: {code: 'destination-not-allowed'},
      });
      expect(downloads).toHaveLength(0);
      expect(rows).toEqual([]);
    });

    it('refuses a symlink that leads out of the workspace', async () => {
      const outside = join(root, 'outside');
      await mkdir(outside);
      await symlink(outside, join(workspace, 'link'));
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream});

      const response = await download(target, {destination: 'link/'});

      expect(response).toMatchObject({ok: false, error: {code: 'destination-not-allowed'}});
      expect(downloads).toHaveLength(0);
    });

    it('names colliding files with a numbered suffix', async () => {
      const {upstream, downloads} = fakeDownloadUpstream({
        'x-shipfox-filename': "UTF-8''report.pdf",
      });
      const target = await start({upstream});

      const names: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const pending = download(target, {destination: 'files/'});
        await vi.waitFor(() => expect(downloads).toHaveLength(index + 1));
        downloads[index]?.send(`copy ${index}`);
        downloads[index]?.finish();
        const response = await pending;
        names.push(response.ok ? response.file.filename : response.error.code);
      }

      expect(names).toEqual(['report.pdf', 'report (2).pdf', 'report (3).pdf']);
      expect(await readFile(join(workspace, 'files', 'report (2).pdf'), 'utf8')).toBe('copy 1');
    });

    it('sanitizes the provider filename and falls back to the call id', async () => {
      const {upstream, downloads} = fakeDownloadUpstream({
        'x-shipfox-filename': "UTF-8''..%2F..%2F.hidden",
      });
      const plain = fakeDownloadUpstream();
      const target = await start({upstream});

      const pending = download(target, {destination: './'});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      downloads[0]?.finish();
      const sanitized = await pending;
      await endpoint?.close();
      const next = await start({upstream: plain.upstream});
      const fallbackPending = download(next, {destination: './'});
      await vi.waitFor(() => expect(plain.downloads).toHaveLength(1));
      plain.downloads[0]?.finish();
      const fallback = await fallbackPending;

      expect(sanitized).toMatchObject({ok: true, file: {filename: 'hidden'}});
      expect(fallback).toMatchObject({
        ok: true,
        file: {filename: `download-${fallback.call_id}`},
      });
    });

    it('refuses a file larger than the limit before writing it', async () => {
      const {upstream, downloads} = fakeDownloadUpstream({
        'x-shipfox-size': String(200 * 1024 * 1024),
      });
      const target = await start({upstream});

      const pending = download(target, {destination: 'big.bin'});
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      const response = await pending;

      expect(response).toMatchObject({ok: false, error: {code: 'file-too-large'}});
      expect(downloads[0]?.options.signal.aborted).toBe(true);
      expect(await readdir(workspace)).toEqual([]);
    });

    it('turns a gateway refusal into a failure', async () => {
      const upstream: ActionToolsUpstream = {
        callTool: () => Promise.reject(new Error('Not a call test.')),
        downloadFile: () =>
          Promise.resolve(
            Response.json(
              {code: 'rate-limited', details: {message: 'Slow down', retryAfterSeconds: 3}},
              {status: 429},
            ),
          ),
      };
      const target = await start({upstream});

      const response = await download(target, {destination: 'file.bin'});

      expect(response).toMatchObject({
        ok: false,
        call_id: expect.stringMatching(UUID_REGEX),
        error: {
          code: 'rate-limited',
          message: 'Slow down',
          retry_after_seconds: 3,
          outcome_unknown: false,
        },
      });
      expect(await readdir(workspace)).toEqual([]);
    });

    it.each([
      ['a JSON tool', {alias: 'slack', tool: 'read_thread'}, 'tool-result-kind-mismatch'],
      ['an ungranted tool', {alias: 'linear', tool: 'export_all'}, 'tool-not-granted'],
    ])('refuses %s before reaching the gateway', async (_label, body, code) => {
      const {upstream, downloads} = fakeDownloadUpstream();
      const target = await start({upstream});

      const response = await download(target, {...body, destination: 'x'});

      expect(response).toMatchObject({ok: false, call_id: null, error: {code}});
      expect(downloads).toHaveLength(0);
    });

    it('refuses a request without a destination', async () => {
      const {upstream} = fakeDownloadUpstream();
      const target = await start({upstream});

      const response = await download(target, {destination: undefined});

      expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
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
        name: 'slack__read_secret',
        input: '[sensitive tool arguments redacted]',
      },
      {
        kind: 'tool-result',
        timestamp: 1000,
        toolCallId: response.call_id,
        toolName: 'slack__read_secret',
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
