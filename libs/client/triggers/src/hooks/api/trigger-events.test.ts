import {configureApiClient} from '@shipfox/client-api';
import {getTriggerEvent, listTriggerEvents, triggerEventsQueryKeys} from './trigger-events.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function requestFrom(fetchImpl: ReturnType<typeof vi.fn>): Request {
  return fetchImpl.mock.calls[0]?.[0] as Request;
}

describe('triggerEventsQueryKeys', () => {
  test('list key nests under the workspace lists key', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const key = triggerEventsQueryKeys.list(workspaceId, {});

    expect(key).toEqual([
      'trigger-events',
      'list',
      workspaceId,
      50,
      {source: null, event: null, outcome: null, from: null, to: null},
    ]);
    expect(key.slice(0, 3)).toEqual(triggerEventsQueryKeys.lists(workspaceId));
  });

  test('keeps distinct page limits on distinct keys', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const defaultLimit = triggerEventsQueryKeys.list(workspaceId, {});
    const compactLimit = triggerEventsQueryKeys.list(workspaceId, {}, 25);

    expect(defaultLimit).not.toEqual(compactLimit);
    expect(defaultLimit[3]).toBe(50);
    expect(compactLimit[3]).toBe(25);
  });

  test('normalizes absent filter fields to null so empty variants share a key', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const empty = triggerEventsQueryKeys.list(workspaceId, {});
    const allUndefined = triggerEventsQueryKeys.list(workspaceId, {
      source: undefined,
      event: undefined,
      outcome: undefined,
      from: undefined,
      to: undefined,
    });

    expect(allUndefined).toEqual(empty);
  });

  test('treats an empty outcome array as no outcome filter', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const key = triggerEventsQueryKeys.list(workspaceId, {outcome: []});

    expect(key[4]).toMatchObject({outcome: null});
  });

  test('sorts and de-duplicates outcome so filter order does not split the cache', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const a = triggerEventsQueryKeys.list(workspaceId, {outcome: ['routed', 'failed']});
    const b = triggerEventsQueryKeys.list(workspaceId, {outcome: ['failed', 'routed', 'failed']});

    expect(a).toEqual(b);
    expect(a[4]).toMatchObject({outcome: ['failed', 'routed']});
  });

  test('keeps distinct filters on distinct keys', () => {
    const workspaceId = '11111111-1111-4111-8111-111111111111';

    const push = triggerEventsQueryKeys.list(workspaceId, {event: 'push'});
    const pr = triggerEventsQueryKeys.list(workspaceId, {event: 'pull_request'});

    expect(push).not.toEqual(pr);
  });

  test('detail key carries the event id', () => {
    const id = '22222222-2222-4222-8222-222222222222';

    expect(triggerEventsQueryKeys.detail(id)).toEqual(['trigger-events', 'detail', id]);
  });
});

describe('listTriggerEvents', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('sends workspace_id and the default limit with no filters', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({workspaceId});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.pathname).toBe('/trigger-events');
    expect(url.searchParams.get('workspace_id')).toBe(workspaceId);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(url.searchParams.has('outcome')).toBe(false);
  });

  test('serializes every filter, the cursor, and a custom limit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({
      workspaceId,
      limit: 25,
      cursor: 'cursor-abc',
      filters: {
        source: 'github',
        event: 'push',
        outcome: ['routed', 'failed'],
        from: '2026-06-01T00:00:00.000Z',
        to: '2026-06-22T00:00:00.000Z',
      },
    });

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('cursor-abc');
    expect(url.searchParams.get('source')).toBe('github');
    expect(url.searchParams.get('event')).toBe('push');
    expect(url.searchParams.get('from')).toBe('2026-06-01T00:00:00.000Z');
    expect(url.searchParams.get('to')).toBe('2026-06-22T00:00:00.000Z');
    expect(url.searchParams.get('outcome')).toBe('failed,routed');
  });

  test('omits the outcome param when the filter array is empty', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({workspaceId, filters: {outcome: []}});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.searchParams.has('outcome')).toBe(false);
  });

  test('sorts and de-duplicates the serialized outcome param', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({trigger_events: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    await listTriggerEvents({workspaceId, filters: {outcome: ['routed', 'failed', 'routed']}});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.searchParams.get('outcome')).toBe('failed,routed');
  });

  test('returns the parsed list response', async () => {
    const page = {
      trigger_events: [],
      next_cursor: 'next-page',
    };
    configureApiClient({fetchImpl: vi.fn(async () => jsonResponse(page))});

    const result = await listTriggerEvents({workspaceId});

    expect(result).toEqual(page);
  });
});

describe('getTriggerEvent', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('requests the event detail by id', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const fetchImpl = vi.fn(async () => jsonResponse({id, decisions: []}));
    configureApiClient({fetchImpl});

    await getTriggerEvent({id});

    const url = new URL(requestFrom(fetchImpl).url);
    expect(url.pathname).toBe(`/trigger-events/${id}`);
    expect(requestFrom(fetchImpl).method).toBe('GET');
  });
});
