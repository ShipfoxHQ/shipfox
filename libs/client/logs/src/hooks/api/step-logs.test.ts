import {configureApiClient} from '@shipfox/client-api';
import {readStepAttemptLogsPage, stepLogsQueryKeys} from './step-logs.js';

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

describe('stepLogsQueryKeys', () => {
  test('keys a log detail by step id and attempt', () => {
    const key = stepLogsQueryKeys.detail('11111111-1111-4111-8111-111111111111', 2);

    expect(key).toEqual(['step-logs', 'detail', '11111111-1111-4111-8111-111111111111', 2]);
  });
});

describe('readStepAttemptLogsPage', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('requests a step attempt log page with the cursor', async () => {
    const body = {
      mode: 'inline',
      ndjson: '',
      next_cursor: 8,
      has_more: false,
      state: 'open',
      truncated: false,
    };
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({fetchImpl});

    const result = await readStepAttemptLogsPage({
      stepId: '11111111-1111-4111-8111-111111111111',
      attempt: 2,
      cursor: 7,
    });

    const url = new URL(requestFrom(fetchImpl).url);
    expect(result).toEqual({
      mode: 'inline',
      ndjson: '',
      nextCursor: 8,
      hasMore: false,
      state: 'open',
      truncated: false,
    });
    expect(url.pathname).toBe('/steps/11111111-1111-4111-8111-111111111111/attempts/2/logs');
    expect(url.searchParams.get('cursor')).toBe('7');
    expect(requestFrom(fetchImpl).method).toBe('GET');
  });

  test('bubbles API errors from the read endpoint', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404}));
    configureApiClient({fetchImpl});

    const result = readStepAttemptLogsPage({
      stepId: '11111111-1111-4111-8111-111111111111',
      attempt: 1,
      cursor: 0,
    });

    await expect(result).rejects.toMatchObject({code: 'not-found', status: 404});
  });

  test('rejects an invalid response envelope before it can advance a cached cursor', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({mode: 'inline', next_cursor: 8}));
    configureApiClient({fetchImpl});

    const result = readStepAttemptLogsPage({
      stepId: '11111111-1111-4111-8111-111111111111',
      attempt: 1,
      cursor: 7,
    });

    await expect(result).rejects.toMatchObject({code: 'invalid-response'});
  });
});
