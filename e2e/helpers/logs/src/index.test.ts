import type {LogRecord, ReadLogsResponseDto} from '@shipfox/api-logs-dto';
import {fetchStepLogs} from './index.js';

const stepId = '11111111-1111-4111-8111-111111111111';

const output = (data: string, ts = 1): LogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream: 'stdout',
  data,
});

function line(record: LogRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function inline(params: {
  hasMore?: boolean;
  ndjson: string;
  nextCursor?: number;
  truncated?: boolean;
}): ReadLogsResponseDto {
  return {
    mode: 'inline',
    ndjson: params.ndjson,
    next_cursor: params.nextCursor ?? 1,
    has_more: params.hasMore ?? false,
    state: 'closed',
    truncated: params.truncated ?? false,
  };
}

function presigned(params: {truncated?: boolean; url?: string} = {}): ReadLogsResponseDto {
  return {
    mode: 'presigned',
    url: params.url ?? 'https://storage.example.test/logs/object?sig=1',
    state: 'closed',
    expires_at: '2026-07-02T08:00:00.000Z',
    total_bytes: 128,
    truncated: params.truncated ?? false,
  };
}

describe('fetchStepLogs', () => {
  test('drains inline pages and parses records', async () => {
    const urls: string[] = [];
    const result = await fetchStepLogs({
      attempt: 1,
      fetch: (url) => {
        urls.push(url.toString());
        return Promise.resolve(
          Response.json(
            urls.length === 1
              ? inline({hasMore: true, ndjson: line(output('first\n')), nextCursor: 7})
              : inline({ndjson: line(output('second\n', 2)), nextCursor: 8, truncated: true}),
          ),
        );
      },
      stepId,
      token: 'user-token',
    });

    expect(urls).toEqual([
      `http://localhost:16101/steps/${stepId}/attempts/1/logs?cursor=0`,
      `http://localhost:16101/steps/${stepId}/attempts/1/logs?cursor=7`,
    ]);
    expect(result.ndjson).toBe(`${line(output('first\n'))}${line(output('second\n', 2))}`);
    expect(result.records).toEqual([output('first\n'), output('second\n', 2)]);
    expect(result.truncated).toBe(true);
  });

  test('reads presigned log objects without sending the API authorization header', async () => {
    const authorizationHeaders: Array<string | null> = [];
    const result = await fetchStepLogs({
      attempt: 1,
      fetch: (url, init) => {
        authorizationHeaders.push(new Headers(init?.headers).get('authorization'));
        if (url.hostname === 'storage.example.test') {
          return Promise.resolve(new Response(line(output('from object\n'))));
        }
        return Promise.resolve(Response.json(presigned()));
      },
      stepId,
      token: 'user-token',
    });

    expect(result.records).toEqual([output('from object\n')]);
    expect(authorizationHeaders).toEqual(['Bearer user-token', null]);
  });

  test('retries an initial missing stream before reading logs', async () => {
    const statuses: number[] = [];
    const result = await fetchStepLogs({
      attempt: 1,
      fetch: () => {
        const response =
          statuses.length === 0
            ? Response.json({code: 'not-found'}, {status: 404})
            : Response.json(inline({ndjson: line(output('eventual logs\n'))}));
        statuses.push(response.status);
        return Promise.resolve(response);
      },
      missingStreamRetryAttempts: 2,
      missingStreamRetryDelayMs: 0,
      stepId,
      token: 'user-token',
    });

    expect(statuses).toEqual([404, 200]);
    expect(result.records).toEqual([output('eventual logs\n')]);
  });

  test('keeps the missing stream failure readable after retry exhaustion', async () => {
    const result = fetchStepLogs({
      attempt: 1,
      fetch: () => Response.json({code: 'not-found'}, {status: 404}),
      missingStreamRetryAttempts: 1,
      missingStreamRetryDelayMs: 0,
      stepId,
      token: 'user-token',
    });

    await expect(result).rejects.toMatchObject({
      message: expect.stringContaining('GET /steps/'),
      status: 404,
      details: {code: 'not-found'},
    });
  });

  test('throws when a log record line is malformed', async () => {
    const result = fetchStepLogs({
      attempt: 1,
      fetch: () => Response.json(inline({ndjson: '{"v":1,"ts":1,"type":"nope"}\n'})),
      stepId,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow();
  });

  test('passes abort signals through reads', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = fetchStepLogs({
      attempt: 1,
      fetch: () => Response.json(inline({ndjson: ''})),
      signal: controller.signal,
      stepId,
      token: 'user-token',
    });

    await expect(result).rejects.toMatchObject({name: 'AbortError'});
  });
});
