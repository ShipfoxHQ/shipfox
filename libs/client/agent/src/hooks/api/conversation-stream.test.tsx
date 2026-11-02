import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {
  type ConversationStreamEvent,
  createConversationStreamState,
  reduceConversationStream,
} from '#core/conversation-stream.js';
import {
  type ConversationStreamItem,
  streamConversationEvents,
  useConversationStream,
} from './conversation-stream.js';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';
const encoder = new TextEncoder();

const itemId = (seq: number) => `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;

function message(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const turn = (status: string, failureCode: string | null = null) =>
  message('turn', {turn_id: TURN_ID, status, failure_code: failureCode});
const delta = (text: string) => message('delta', {turn_id: TURN_ID, model_call_index: 0, text});
const reset = (reason: 'reconnect' | 'retry') => message('reset', {reason});

function itemDto(params: {id: string; seq: number | null; turnId: string | null}) {
  return {
    id: params.id,
    seq: params.seq,
    entry_type: 'message',
    turn_id: params.turnId,
    author_user_id: null,
    client_message_id: null,
    content: null,
    created_at: '2026-11-02T10:00:00.000Z',
  };
}

const reply = (seq: number) => message('item', itemDto({id: itemId(seq), seq, turnId: TURN_ID}));

/** A response that sends its messages, then ends, or fails the way a dropped connection does. */
function streamResponse(messages: string[], options: {dropsAfter?: boolean} = {}): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(messages.join('')));
        return;
      }
      if (options.dropsAfter) controller.error(new TypeError('terminated'));
      else controller.close();
    },
  });
  return new Response(body, {status: 200, headers: {'content-type': 'text/event-stream'}});
}

function requestedAfterSeq(fetchImpl: ReturnType<typeof vi.fn>, call: number): string | null {
  const [url] = fetchImpl.mock.calls[call] as [string];
  return new URL(url).searchParams.get('after_seq');
}

/** Runs the stream to its end, keeping the state after every event. */
async function follow(params: {afterSeq: number}) {
  const states = [createConversationStreamState<ConversationStreamItem>(params.afterSeq)];
  const events: ConversationStreamEvent<ConversationStreamItem>[] = [];
  const stream = streamConversationEvents({
    conversationId: CONVERSATION_ID,
    afterSeq: params.afterSeq,
  });
  for await (const event of stream) {
    events.push(event);
    states.push(reduceConversationStream(states.at(-1) as (typeof states)[number], event));
  }
  return {events, states, final: states.at(-1) as (typeof states)[number]};
}

describe('streamConversationEvents', () => {
  beforeEach(() => {
    resetApiClient();
    configureApiClient({baseUrl: 'https://api.example.test'});
  });

  afterEach(() => {
    vi.useRealTimers();
    resetApiClient();
  });

  it('ends with the stored reply and no partial text', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          turn('running'),
          reset('reconnect'),
          delta('Hel'),
          delta('lo'),
          reply(2),
          turn('succeeded'),
        ]),
      );
    configureApiClient({fetchImpl});

    const {final} = await follow({afterSeq: 1});

    expect(final.partialText).toBe('');
    expect(final.items.map((item) => item.id)).toEqual([itemId(2)]);
    expect(final.turn).toMatchObject({status: 'succeeded'});
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requestedAfterSeq(fetchImpl, 0)).toBe('1');
  });

  it('reconnects after a dropped stream and ends with the correct text', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([turn('running'), reset('reconnect'), delta('Hel')], {dropsAfter: true}),
      )
      .mockResolvedValueOnce(
        streamResponse([
          turn('running'),
          reset('reconnect'),
          delta('Hel'),
          delta('lo'),
          reply(2),
          turn('succeeded'),
        ]),
      );
    configureApiClient({fetchImpl});

    const done = follow({afterSeq: 1});
    await vi.advanceTimersByTimeAsync(1_000);
    const {states, final} = await done;

    // Without the reset, the text would read "HelHello" after the reconnect.
    expect(states.map((state) => state.partialText)).toContain('Hello');
    expect(states.map((state) => state.partialText)).not.toContain('HelHel');
    expect(final.partialText).toBe('');
    expect(final.items.map((item) => item.id)).toEqual([itemId(2)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reconnects from the last item it received', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse(
          [turn('running'), message('item', itemDto({id: itemId(5), seq: 5, turnId: TURN_ID}))],
          {dropsAfter: true},
        ),
      )
      .mockResolvedValueOnce(streamResponse([turn('running'), reply(6), turn('succeeded')]));
    configureApiClient({fetchImpl});

    const done = follow({afterSeq: 4});
    await vi.advanceTimersByTimeAsync(1_000);
    const {final} = await done;

    expect(requestedAfterSeq(fetchImpl, 0)).toBe('4');
    expect(requestedAfterSeq(fetchImpl, 1)).toBe('5');
    expect(final.items.map((item) => item.seq)).toEqual([5, 6]);
  });

  it('clears partial text when a model call is retried', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          turn('running'),
          reset('reconnect'),
          delta('Partial from the failed call'),
          reset('retry'),
          delta('Fresh'),
          reply(2),
          turn('succeeded'),
        ]),
      );
    configureApiClient({fetchImpl});

    const {states, final} = await follow({afterSeq: 1});

    const texts = states.map((state) => state.partialText);
    expect(texts).toContain('Partial from the failed call');
    expect(texts).toContain('Fresh');
    expect(texts).not.toContain('Partial from the failed callFresh');
    expect(final.partialText).toBe('');
  });

  it('reopens a stream that closed with the turn still running', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(streamResponse([turn('running'), delta('Hel')]))
      .mockResolvedValueOnce(
        streamResponse([
          turn('running'),
          reset('reconnect'),
          delta('Hello'),
          reply(2),
          turn('succeeded'),
        ]),
      );
    configureApiClient({fetchImpl});

    const done = follow({afterSeq: 1});
    await vi.advanceTimersByTimeAsync(1_000);
    const {final} = await done;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(final.partialText).toBe('');
  });

  it('ends without reconnecting when no turn runs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamResponse([message('item', itemDto({id: itemId(2), seq: 2, turnId: null}))]),
      );
    configureApiClient({fetchImpl});

    const {final} = await follow({afterSeq: 1});

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(final.items.map((item) => item.id)).toEqual([itemId(2)]);
  });

  it('gives up after repeated drops', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    configureApiClient({fetchImpl});

    const done = follow({afterSeq: 1}).catch((error) => error);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await done).toMatchObject({code: 'network-error'});
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('does not retry a refused request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({code: 'conversation-not-found', message: 'Not found'}), {
        status: 404,
        headers: {'content-type': 'application/json'},
      }),
    );
    configureApiClient({fetchImpl});

    const error = await follow({afterSeq: 1}).catch((e) => e);

    expect(error).toMatchObject({status: 404, code: 'conversation-not-found'});
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('useConversationStream', () => {
  beforeEach(() => {
    resetApiClient();
    configureApiClient({baseUrl: 'https://api.example.test'});
  });

  afterEach(() => {
    resetApiClient();
  });

  function renderStream(params: {enabled: boolean}) {
    const queryClient = new QueryClient();
    const wrapper = ({children}: {children: ReactNode}) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(
      () => useConversationStream({conversationId: CONVERSATION_ID, afterSeq: 1, ...params}),
      {wrapper},
    );
  }

  it('holds what the stream sent while a turn is active', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        streamResponse([
          turn('running'),
          reset('reconnect'),
          delta('Hello'),
          reply(2),
          turn('succeeded'),
        ]),
      );
    configureApiClient({fetchImpl});

    const {result} = renderStream({enabled: true});

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(result.current.data?.items.map((item) => item.id)).toEqual([itemId(2)]);
    expect(result.current.data?.partialText).toBe('');
    expect(result.current.data?.turn).toMatchObject({status: 'succeeded'});
  });

  it('opens no stream while no turn is active', () => {
    const fetchImpl = vi.fn();
    configureApiClient({fetchImpl});

    renderStream({enabled: false});

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
