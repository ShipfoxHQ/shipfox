import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {useChatConversation} from './chat-conversation.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const itemId = (seq: number) => `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;

function itemDto(seq: number) {
  return {
    id: itemId(seq),
    seq,
    entry_type: 'message',
    turn_id: null,
    author_user_id: null,
    client_message_id: null,
    content: null,
    created_at: '2026-11-02T10:00:00.000Z',
  };
}

const detail = {
  id: CONVERSATION_ID,
  project_id: PROJECT_ID,
  agent_key: 'shippy',
  title: 'Implement it',
  unread: true,
  last_seq: 2,
  last_agent_seq: 2,
  last_read_seq: 1,
  last_activity_at: '2026-11-02T10:00:00.000Z',
  created_at: '2026-11-02T10:00:00.000Z',
  active_turn: null,
  latest_turn: null,
  active_runs: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function arrangeApi() {
  const reads: unknown[] = [];
  // ky hands over a `Request`, with the body on it.
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/read')) {
      reads.push(await request.json());
      return new Response(null, {status: 204});
    }
    if (url.pathname.endsWith('/items')) {
      return json({
        items: [itemDto(1), itemDto(2)],
        queued: [],
        queued_has_more: false,
        has_more: false,
      });
    }
    if (url.pathname.endsWith(`/conversations/${CONVERSATION_ID}`)) return json(detail);
    return json({conversations: [], next_cursor: null, unread_count: 0});
  });
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  return {reads};
}

function render(params: {latestVisible: boolean}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    (props: {latestVisible: boolean}) =>
      useChatConversation({
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
        active: true,
        latestVisible: props.latestVisible,
        onCreated: () => undefined,
      }),
    {wrapper, initialProps: params},
  );
}

function arrangeTab(params: {visible: boolean; focused: boolean}) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(
    params.visible ? 'visible' : 'hidden',
  );
  vi.spyOn(document, 'hasFocus').mockReturnValue(params.focused);
}

describe('useChatConversation read state', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetApiClient();
  });

  test('marks the latest item read once it is in view in a focused tab', async () => {
    const {reads} = arrangeApi();
    arrangeTab({visible: true, focused: true});

    render({latestVisible: true});

    await waitFor(() => expect(reads).toEqual([{last_read_seq: 2}]));
  });

  test('leaves a reply unread in a hidden tab, then reads it when the tab comes back', async () => {
    const {reads} = arrangeApi();
    arrangeTab({visible: false, focused: false});

    const {result} = render({latestVisible: true});
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(reads).toEqual([]);

    arrangeTab({visible: true, focused: true});
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(reads).toEqual([{last_read_seq: 2}]));
  });

  test('leaves a reply unread in a visible tab without focus', async () => {
    const {reads} = arrangeApi();
    arrangeTab({visible: true, focused: false});

    const {result} = render({latestVisible: true});
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(reads).toEqual([]);
  });

  test('waits until the latest item is scrolled into view', async () => {
    const {reads} = arrangeApi();
    arrangeTab({visible: true, focused: true});

    const {result, rerender} = render({latestVisible: false});
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(reads).toEqual([]);

    rerender({latestVisible: true});

    await waitFor(() => expect(reads).toEqual([{last_read_seq: 2}]));
  });
});
