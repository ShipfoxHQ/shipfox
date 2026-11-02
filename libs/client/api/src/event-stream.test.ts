import {z} from 'zod';
import {
  ApiError,
  checkedApiEventStream,
  configureApiClient,
  isInvalidApiResponseError,
  resetApiClient,
} from './index.js';
import {parseServerSentEvents} from './server-sent-events.js';

const encoder = new TextEncoder();

function bodyOf(chunks: string[], failure?: Error): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk !== undefined) {
        controller.enqueue(encoder.encode(chunk));
      } else if (failure) {
        controller.error(failure);
      } else {
        controller.close();
      }
    },
  });
}

function streamResponse(chunks: string[], init: ResponseInit = {}, failure?: Error): Response {
  return new Response(bodyOf(chunks, failure), {
    status: 200,
    headers: {'content-type': 'text/event-stream'},
    ...init,
  });
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const received: T[] = [];
  for await (const message of stream) received.push(message);
  return received;
}

describe('parseServerSentEvents', () => {
  it('parses named events and the default event', async () => {
    const body = bodyOf(['event: item\ndata: {"a":1}\n\ndata: plain\n\n']);

    const messages = await collect(parseServerSentEvents(body));

    expect(messages).toEqual([
      {event: 'item', data: '{"a":1}'},
      {event: 'message', data: 'plain'},
    ]);
  });

  it('joins data lines with a newline', async () => {
    const body = bodyOf(['data: one\ndata: two\n\n']);

    const messages = await collect(parseServerSentEvents(body));

    expect(messages).toEqual([{event: 'message', data: 'one\ntwo'}]);
  });

  it('ignores comments, so a heartbeat is not a message', async () => {
    const body = bodyOf([': connected\n\n: heartbeat\n\nevent: turn\ndata: {}\n\n']);

    const messages = await collect(parseServerSentEvents(body));

    expect(messages).toEqual([{event: 'turn', data: '{}'}]);
  });

  it('reassembles a message split across chunks, inside a line and inside a multi-byte character', async () => {
    const bytes = encoder.encode('event: delta\ndata: {"text":"héllo"}\n\n');
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8));
        controller.enqueue(bytes.slice(8, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });

    const messages = await collect(parseServerSentEvents(body));

    expect(messages).toEqual([{event: 'delta', data: '{"text":"héllo"}'}]);
  });

  it('reads CRLF breaks, including one split between two chunks', async () => {
    const body = bodyOf(['event: turn\r', '\ndata: {}\r\n\r', '\n']);

    const messages = await collect(parseServerSentEvents(body));

    expect(messages).toEqual([{event: 'turn', data: '{}'}]);
  });

  it('drops a message the stream cut off', async () => {
    const body = bodyOf(['data: whole\n\ndata: cut']);

    const messages = await collect(parseServerSentEvents(body));

    expect(messages).toEqual([{event: 'message', data: 'whole'}]);
  });
});

describe('checkedApiEventStream', () => {
  const schema = z.discriminatedUnion('event', [
    z.object({event: z.literal('delta'), data: z.object({text: z.string()})}),
    z.object({event: z.literal('turn'), data: z.object({status: z.string()})}),
  ]);

  beforeEach(() => {
    resetApiClient();
    configureApiClient({baseUrl: 'https://api.example.test'});
  });

  afterEach(() => {
    resetApiClient();
  });

  it('asks for an event stream with the bearer token and credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse([]));
    configureApiClient({fetchImpl, getAccessToken: () => 'access-token'});

    await collect(checkedApiEventStream(schema, '/conversations/c1/stream?after_seq=4'));

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('https://api.example.test/conversations/c1/stream?after_seq=4');
    expect(init.credentials).toBe('include');
    expect(headers.get('authorization')).toBe('Bearer access-token');
    expect(headers.get('accept')).toBe('text/event-stream');
  });

  it('yields each validated message in order and ends with the stream', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          ': connected\n\n',
          'event: delta\ndata: {"text":"Hel"}\n\n',
          'event: delta\ndata: {"text":"lo"}\n\nevent: turn\ndata: {"status":"succeeded"}\n\n',
        ]),
      );
    configureApiClient({fetchImpl});

    const messages = await collect(checkedApiEventStream(schema, '/stream'));

    expect(messages).toEqual([
      {event: 'delta', data: {text: 'Hel'}},
      {event: 'delta', data: {text: 'lo'}},
      {event: 'turn', data: {status: 'succeeded'}},
    ]);
  });

  it.each([
    {name: 'malformed JSON', body: 'event: delta\ndata: {"text":"secret",\n\n'},
    {
      name: 'a payload the schema rejects',
      body: 'event: delta\ndata: {"text":123,"secret":"secret"}\n\n',
    },
  ])('rejects $name without exposing it', async ({body}) => {
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse([body]));
    configureApiClient({fetchImpl});

    const error = await collect(checkedApiEventStream(schema, '/stream')).catch((e) => e);

    expect(isInvalidApiResponseError(error)).toBe(true);
    expect(String(error.message)).not.toContain('secret');
  });

  it('rejects an event outside the schema', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse(['event: ping\ndata: {}\n\n']));
    configureApiClient({fetchImpl});

    const error = await collect(checkedApiEventStream(schema, '/stream')).catch((e) => e);

    expect(isInvalidApiResponseError(error)).toBe(true);
  });

  it('throws the API error of a refused request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({code: 'conversation-not-found', message: 'Conversation not found'}),
        {
          status: 404,
          headers: {'content-type': 'application/json'},
        },
      ),
    );
    configureApiClient({fetchImpl});

    const error = await collect(checkedApiEventStream(schema, '/stream')).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({status: 404, code: 'conversation-not-found'});
  });

  it('retries once with a refreshed token after a rejected bearer', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({code: 'unauthorized', message: 'Expired'}), {status: 401}),
      )
      .mockResolvedValueOnce(streamResponse(['event: turn\ndata: {"status":"running"}\n\n']));
    configureApiClient({
      fetchImpl,
      getAccessToken: () => 'old-token',
      retryAccessToken: () => 'new-token',
    });

    const messages = await collect(checkedApiEventStream(schema, '/stream'));

    const retried = new Headers((fetchImpl.mock.calls[1] as [string, RequestInit])[1].headers);
    expect(messages).toEqual([{event: 'turn', data: {status: 'running'}}]);
    expect(retried.get('authorization')).toBe('Bearer new-token');
  });

  it('reports a dropped connection as a network error, so the caller can reconnect', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamResponse(['event: delta\ndata: {"text":"Hel"}\n\n'], {}, new TypeError('terminated')),
      );
    configureApiClient({fetchImpl});
    const received: unknown[] = [];

    const error = await (async () => {
      for await (const message of checkedApiEventStream(schema, '/stream')) received.push(message);
    })().catch((e) => e);

    expect(received).toEqual([{event: 'delta', data: {text: 'Hel'}}]);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({code: 'network-error', status: 0});
  });

  it('reports an unreachable server as a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    configureApiClient({fetchImpl});

    const error = await collect(checkedApiEventStream(schema, '/stream')).catch((e) => e);

    expect(error).toMatchObject({code: 'network-error'});
  });

  it('surfaces an abort as the abort, not a network error', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(streamController) {
              init.signal?.addEventListener('abort', () =>
                streamController.error(new DOMException('Aborted', 'AbortError')),
              );
            },
          }),
        ),
      );
    });
    configureApiClient({fetchImpl});

    const pending = collect(checkedApiEventStream(schema, '/stream', {signal: controller.signal}));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    controller.abort();

    const error = await pending.catch((e) => e);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({name: 'AbortError'});
  });
});
