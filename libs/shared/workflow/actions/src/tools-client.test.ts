import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {MAX_TOOL_REQUEST_BYTES} from '#contract.js';
import {ToolCallError} from '#tool-call-error.js';
import {ToolResult} from '#tool-result.js';
import {createToolsClient, type RetryClock, type Tools} from '#tools-client.js';

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

type Reply = (request: RecordedRequest, response: ServerResponse) => void;

const TOKEN = 'step-token';

describe('createToolsClient', () => {
  let server: Server;
  let url: string;
  let requests: RecordedRequest[];
  let replies: Reply[];

  beforeEach(async () => {
    requests = [];
    replies = [];
    server = createServer((request, response) => {
      void readRequest(request).then((recorded) => {
        requests.push(recorded);
        const reply = replies.shift() ?? replyJson(500, {});
        reply(recorded, response);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  function client(clock?: RetryClock): Tools {
    return createToolsClient({url, token: TOKEN, ...(clock ? {clock} : {})});
  }

  describe('call', () => {
    it('posts the alias, tool, and arguments with the step token', async () => {
      replies.push(replyJson(200, callSuccess({structured: {messages: []}})));

      await client().slack?.call('read_thread', {channel_id: 'C1'});

      expect(requests).toEqual([
        {
          method: 'POST',
          url: '/v1/tools/call',
          authorization: `Bearer ${TOKEN}`,
          body: {alias: 'slack', tool: 'read_thread', arguments: {channel_id: 'C1'}},
        },
      ]);
    });

    it('sends empty arguments when none are given', async () => {
      replies.push(replyJson(200, callSuccess({structured: null})));

      await client().github?.call('pull_requests.list');

      expect(requests[0]?.body).toEqual({
        alias: 'github',
        tool: 'pull_requests.list',
        arguments: {},
      });
    });

    it('returns structured content and raw content blocks', async () => {
      replies.push(
        replyJson(
          200,
          callSuccess({
            structured: {id: 'ENG-1'},
            content: [
              {type: 'text', text: '{"id":'},
              {type: 'image', data: 'AA=='},
              {type: 'text', text: '"ENG-1"}'},
            ],
          }),
        ),
      );

      const result = await client().linear?.call('get_issue', {id: 'ENG-1'});

      expect(result).toBeInstanceOf(ToolResult);
      expect(result?.structured).toEqual({id: 'ENG-1'});
      expect(result?.content).toHaveLength(3);
      expect(result?.text()).toBe('{"id":\n"ENG-1"}');
      expect(result?.json()).toEqual({id: 'ENG-1'});
    });

    it('throws from json() when the text is not JSON', async () => {
      replies.push(
        replyJson(200, callSuccess({structured: null, content: [{type: 'text', text: 'Done.'}]})),
      );

      const result = await client().linear?.call('save_issue');

      expect(() => result?.json()).toThrow('Tool result text is not JSON: Done.');
    });

    it('does not parse text into structured content', async () => {
      replies.push(
        replyJson(200, callSuccess({structured: null, content: [{type: 'text', text: '{"a":1}'}]})),
      );

      const result = await client().linear?.call('get_issue');

      expect(result?.structured).toBeNull();
    });
  });

  describe('download', () => {
    it('posts the destination and maps the file metadata', async () => {
      replies.push(
        replyJson(200, {
          ok: true,
          call_id: 'call-1',
          file: {
            path: 'context/files/design.pdf',
            bytes: 1024,
            sha256: 'ab'.repeat(32),
            media_type: 'application/pdf',
            filename: 'design.pdf',
          },
        }),
      );

      const file = await client().linear?.download(
        'download_file',
        {url: 'https://uploads.linear.app/x'},
        {destination: 'context/files/'},
      );

      expect(requests[0]?.url).toBe('/v1/tools/download');
      expect(requests[0]?.body).toEqual({
        alias: 'linear',
        tool: 'download_file',
        arguments: {url: 'https://uploads.linear.app/x'},
        destination: 'context/files/',
      });
      expect(file).toEqual({
        path: 'context/files/design.pdf',
        bytes: 1024,
        sha256: 'ab'.repeat(32),
        mediaType: 'application/pdf',
        filename: 'design.pdf',
      });
    });
  });

  describe('error mapping', () => {
    it('maps an endpoint error to ToolCallError', async () => {
      replies.push(
        replyJson(200, {
          ok: false,
          call_id: 'call-7',
          error: {
            code: 'provider-rejected',
            reason: 'stale-head',
            message: 'The branch head moved.',
            outcome_unknown: false,
          },
        }),
      );

      const error = await rejection(client().github?.call('create_commit', {}));

      expect(error).toBeInstanceOf(ToolCallError);
      expect(error).toMatchObject({
        code: 'provider-rejected',
        reason: 'stale-head',
        message: 'github.create_commit: The branch head moved.',
        retryAfterSeconds: undefined,
        outcomeUnknown: false,
        callId: 'call-7',
      });
    });

    it('keeps outcome_unknown from the endpoint', async () => {
      replies.push(
        replyJson(502, {
          ok: false,
          call_id: 'call-8',
          error: {code: 'provider-timeout', message: 'No answer.', outcome_unknown: true},
        }),
      );

      const error = await rejection(client().github?.call('create_commit', {}));

      expect(error).toMatchObject({
        code: 'provider-timeout',
        outcomeUnknown: true,
        callId: 'call-8',
      });
    });

    it('accepts a refusal without a call id', async () => {
      replies.push(
        replyJson(403, {
          ok: false,
          call_id: null,
          error: {code: 'tool-not-granted', message: 'Not granted.', outcome_unknown: false},
        }),
      );

      const error = await rejection(client().slack?.call('post_message', {}));

      expect(error).toMatchObject({code: 'tool-not-granted', callId: null, outcomeUnknown: false});
    });

    it('reports an unexpected response as invalid-response with an unknown outcome', async () => {
      replies.push(replyText(401, 'Unauthorized'));

      const error = await rejection(client().slack?.call('read_thread', {}));

      expect(error).toMatchObject({
        code: 'invalid-response',
        message:
          'slack.read_thread: the local tool endpoint returned an unexpected response (HTTP 401).',
        outcomeUnknown: true,
        callId: null,
      });
    });

    it('rejects a success response without its result', async () => {
      replies.push(replyJson(200, {ok: true, call_id: 'call-9'}));

      const error = await rejection(client().slack?.call('read_thread', {}));

      expect(error).toMatchObject({code: 'invalid-response', callId: 'call-9'});
    });

    it('reports a closed endpoint as endpoint-unavailable', async () => {
      replies.push((_request, response) => response.socket?.destroy());

      const error = await rejection(client().slack?.call('read_thread', {}));

      expect(error).toMatchObject({code: 'endpoint-unavailable', outcomeUnknown: true});
    });

    it('reports an aborted call as cancelled with an unknown outcome', async () => {
      const controller = new AbortController();
      replies.push(() => controller.abort());

      const error = await rejection(
        client().github?.call('create_commit', {}, {signal: controller.signal}),
      );

      expect(error).toMatchObject({code: 'cancelled', outcomeUnknown: true, callId: null});
    });

    it('reports an already aborted signal as cancelled without sending', async () => {
      const signal = AbortSignal.abort();

      const error = await rejection(client().github?.call('create_commit', {}, {signal}));

      expect(error).toMatchObject({code: 'cancelled', outcomeUnknown: false, callId: null});
      expect(requests).toEqual([]);
    });

    it('reports an abort while reading the response as cancelled', async () => {
      const controller = new AbortController();
      replies.push((_request, response) => {
        response.writeHead(200, {'content-type': 'application/json'});
        response.write('{"ok":');
      });
      const tools = createToolsClient({
        url,
        token: TOKEN,
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          controller.abort();
          return response;
        },
      });

      const error = await rejection(
        tools.github?.call('create_commit', {}, {signal: controller.signal}),
      );

      expect(error).toMatchObject({code: 'cancelled', outcomeUnknown: true});
    });
  });

  describe('request size', () => {
    it('throws request-too-large before any network call', async () => {
      const content = 'x'.repeat(MAX_TOOL_REQUEST_BYTES);

      const error = await rejection(client().github?.call('create_commit', {content}));

      expect(error).toBeInstanceOf(ToolCallError);
      expect(error).toMatchObject({code: 'request-too-large', outcomeUnknown: false, callId: null});
      expect(requests).toEqual([]);
    });

    it('measures the encoded bytes, not the characters', async () => {
      const content = 'é'.repeat(MAX_TOOL_REQUEST_BYTES / 2);

      const error = await rejection(client().github?.call('create_commit', {content}));

      expect(error).toMatchObject({code: 'request-too-large'});
      expect(requests).toEqual([]);
    });

    it('sends a request just under the limit', async () => {
      replies.push(replyJson(200, callSuccess({structured: null})));
      const envelope = JSON.stringify({
        alias: 'github',
        tool: 'create_commit',
        arguments: {content: ''},
      });
      const content = 'x'.repeat(MAX_TOOL_REQUEST_BYTES - envelope.length);

      await client().github?.call('create_commit', {content});

      expect(requests).toHaveLength(1);
    });

    it('checks download requests too', async () => {
      const url = 'x'.repeat(MAX_TOOL_REQUEST_BYTES);

      const error = await rejection(
        client().linear?.download('download_file', {url}, {destination: 'files/'}),
      );

      expect(error).toMatchObject({code: 'request-too-large'});
      expect(requests).toEqual([]);
    });
  });

  describe('rate-limited retries', () => {
    it('retries after retry_after_seconds and returns the later success', async () => {
      const clock = fakeClock();
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 2})));
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 5})));
      replies.push(replyJson(200, callSuccess({structured: {ok: 1}})));

      const result = await client(clock).slack?.call('read_thread', {});

      expect(result?.structured).toEqual({ok: 1});
      expect(clock.sleeps).toEqual([2000, 5000]);
      expect(requests).toHaveLength(3);
    });

    it('backs off exponentially when no retry_after_seconds is given', async () => {
      const clock = fakeClock();
      replies.push(replyJson(200, rateLimited({})));
      replies.push(replyJson(200, rateLimited({})));
      replies.push(replyJson(200, rateLimited({})));
      replies.push(replyJson(200, callSuccess({structured: null})));

      await client(clock).slack?.call('read_thread', {});

      expect(clock.sleeps).toEqual([1000, 2000, 4000]);
    });

    it('stops after 3 retries and throws the last rate-limited error', async () => {
      const clock = fakeClock();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        replies.push(
          replyJson(200, rateLimited({retryAfterSeconds: 1, callId: `call-${attempt}`})),
        );
      }

      const error = await rejection(client(clock).slack?.call('read_thread', {}));

      expect(error).toMatchObject({code: 'rate-limited', retryAfterSeconds: 1, callId: 'call-3'});
      expect(clock.sleeps).toEqual([1000, 1000, 1000]);
      expect(requests).toHaveLength(4);
    });

    it('does not wait past 60 seconds in total', async () => {
      const clock = fakeClock();
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 30})));
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 30})));
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 1})));

      const error = await rejection(client(clock).slack?.call('read_thread', {}));

      expect(error).toMatchObject({code: 'rate-limited', retryAfterSeconds: 1});
      expect(clock.sleeps).toEqual([30_000, 30_000]);
      expect(requests).toHaveLength(3);
    });

    it('does not retry when the first wait exceeds the budget', async () => {
      const clock = fakeClock();
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 61})));

      const error = await rejection(client(clock).slack?.call('read_thread', {}));

      expect(error).toMatchObject({code: 'rate-limited', retryAfterSeconds: 61});
      expect(clock.sleeps).toEqual([]);
    });

    it('does not retry a rate-limited error with an unknown outcome', async () => {
      const clock = fakeClock();
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 1, outcomeUnknown: true})));

      const error = await rejection(client(clock).github?.call('create_commit', {}));

      expect(error).toMatchObject({code: 'rate-limited', outcomeUnknown: true});
      expect(clock.sleeps).toEqual([]);
      expect(requests).toHaveLength(1);
    });

    it.each([
      'provider-unavailable',
      'provider-timeout',
      'timeout',
      'unknown',
    ])('does not retry %s', async (code) => {
      const clock = fakeClock();
      replies.push(
        replyJson(200, {
          ok: false,
          call_id: 'call-1',
          error: {code, message: 'Failed.', retry_after_seconds: 1, outcome_unknown: false},
        }),
      );

      const error = await rejection(client(clock).slack?.call('read_thread', {}));

      expect(error).toMatchObject({code});
      expect(requests).toHaveLength(1);
    });

    it('stops waiting when the signal aborts, with a known outcome', async () => {
      const controller = new AbortController();
      const clock = fakeClock({onSleep: () => controller.abort()});
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 1, callId: 'call-1'})));

      const error = await rejection(
        client(clock).slack?.call('read_thread', {}, {signal: controller.signal}),
      );

      expect(error).toMatchObject({code: 'cancelled', outcomeUnknown: false, callId: 'call-1'});
      expect(requests).toHaveLength(1);
    });

    it('waits in real time with the default clock', async () => {
      replies.push(replyJson(200, rateLimited({retryAfterSeconds: 0.05})));
      replies.push(replyJson(200, callSuccess({structured: null})));
      const startedAt = performance.now();

      await client().slack?.call('read_thread', {});

      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(45);
      expect(requests).toHaveLength(2);
    });
  });

  it('returns the same client for an alias and ignores non-alias probes', () => {
    const tools = client();

    expect(tools.slack).toBe(tools.slack);
    expect((tools as unknown as {then: unknown}).then).toBeUndefined();
  });
});

function callSuccess(result: {structured: unknown; content?: unknown[]}) {
  return {ok: true, call_id: 'call-1', result: {content: [], ...result}};
}

function rateLimited(params: {
  retryAfterSeconds?: number;
  callId?: string;
  outcomeUnknown?: boolean;
}) {
  return {
    ok: false,
    call_id: params.callId ?? 'call-1',
    error: {
      code: 'rate-limited',
      message: 'Slow down.',
      outcome_unknown: params.outcomeUnknown ?? false,
      ...(params.retryAfterSeconds === undefined
        ? {}
        : {retry_after_seconds: params.retryAfterSeconds}),
    },
  };
}

function replyJson(status: number, body: unknown): Reply {
  return (_request, response) => {
    response.writeHead(status, {'content-type': 'application/json'});
    response.end(JSON.stringify(body));
  };
}

function replyText(status: number, body: string): Reply {
  return (_request, response) => {
    response.writeHead(status, {'content-type': 'text/plain'});
    response.end(body);
  };
}

async function readRequest(request: IncomingMessage): Promise<RecordedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return {
    method: request.method,
    url: request.url,
    authorization: request.headers.authorization,
    body: raw === '' ? undefined : JSON.parse(raw),
  };
}

function fakeClock(options: {onSleep?: () => void} = {}): RetryClock & {sleeps: number[]} {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: (ms, signal) => {
      sleeps.push(ms);
      options.onSleep?.();
      if (signal?.aborted) return Promise.reject(signal.reason);
      now += ms;
      return Promise.resolve();
    },
  };
}

async function rejection(promise: Promise<unknown> | undefined): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}
