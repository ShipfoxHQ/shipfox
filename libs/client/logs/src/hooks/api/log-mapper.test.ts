import {parseLogNdjson, toLogRead} from './log-mapper.js';

const outputLine = (data: string, ts = 1): string =>
  `${JSON.stringify({v: 1, ts, type: 'output', stream: 'stdout', data})}\n`;

describe('parseLogNdjson', () => {
  test('validates and maps records to package-owned camel-case fields', () => {
    const records = parseLogNdjson(
      `${JSON.stringify({
        v: 1,
        ts: 1,
        type: 'group_start',
        group_id: 'build',
        parent_group_id: null,
        name: 'Build',
      })}\r\n${outputLine('done\n', 2)}`,
    );

    expect(records).toEqual([
      {
        v: 1,
        ts: 1,
        type: 'group_start',
        groupId: 'build',
        parentGroupId: null,
        name: 'Build',
      },
      {v: 1, ts: 2, type: 'output', stream: 'stdout', data: 'done\n'},
    ]);
  });

  test('rejects an invalid external record before a snapshot can be merged', () => {
    expect(() => parseLogNdjson('{"v":1,"ts":1,"type":"nope"}\n')).toThrow();
  });
});

describe('toLogRead', () => {
  test('maps response envelopes to camel-case domain fields', () => {
    expect(
      toLogRead({
        mode: 'presigned',
        url: 'https://storage.example.test/logs/object?sig=1',
        state: 'closed',
        expires_at: '2026-06-23T10:00:00.000Z',
        total_bytes: 128,
        truncated: false,
      }),
    ).toEqual({
      mode: 'presigned',
      url: 'https://storage.example.test/logs/object?sig=1',
      expiresAt: '2026-06-23T10:00:00.000Z',
      totalBytes: 128,
      truncated: false,
    });
  });
});
