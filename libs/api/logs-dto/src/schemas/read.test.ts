import {readLogsQuerySchema, readLogsResponseSchema} from './read.js';

describe('readLogsQuerySchema', () => {
  it('defaults the cursor to 0 when omitted', () => {
    const parsed = readLogsQuerySchema.parse({});

    expect(parsed.cursor).toBe(0);
  });

  it('coerces a string cursor to an integer', () => {
    const parsed = readLogsQuerySchema.parse({cursor: '42'});

    expect(parsed.cursor).toBe(42);
  });

  it('rejects a negative cursor', () => {
    const parse = () => readLogsQuerySchema.parse({cursor: '-1'});

    expect(parse).toThrow();
  });
});

describe('readLogsResponseSchema', () => {
  it('parses the inline variant', () => {
    const parsed = readLogsResponseSchema.parse({
      mode: 'inline',
      ndjson: '{"v":1,"ts":1,"type":"output","stream":"stdout","data":"hi\\n"}\n',
      next_cursor: 7,
      has_more: true,
      state: 'open',
      truncated: false,
    });

    expect(parsed.mode).toBe('inline');
  });

  it('parses the presigned variant', () => {
    const parsed = readLogsResponseSchema.parse({
      mode: 'presigned',
      url: 'https://storage.example/logs/object?sig=abc',
      expires_at: new Date().toISOString(),
      total_bytes: 1024,
      truncated: true,
    });

    expect(parsed.mode).toBe('presigned');
  });

  it('rejects an unknown mode', () => {
    const parse = () => readLogsResponseSchema.parse({mode: 'proxy'});

    expect(parse).toThrow();
  });

  it('rejects a non-URL presigned url', () => {
    const parse = () =>
      readLogsResponseSchema.parse({
        mode: 'presigned',
        url: 'not a url',
        expires_at: new Date().toISOString(),
        total_bytes: 1,
        truncated: false,
      });

    expect(parse).toThrow();
  });
});
