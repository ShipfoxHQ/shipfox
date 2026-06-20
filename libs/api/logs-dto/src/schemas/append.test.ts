import {appendLogsQuerySchema, offsetGapResponseSchema} from './append.js';

describe('appendLogsQuerySchema', () => {
  it('coerces string query params to integers and carries the kind', () => {
    const parsed = appendLogsQuerySchema.parse({attempt: '1', offset: '0', kind: 'log_stream'});

    expect(parsed).toEqual({attempt: 1, offset: 0, kind: 'log_stream'});
  });

  it('accepts the agent_session kind', () => {
    const parsed = appendLogsQuerySchema.parse({attempt: '1', offset: '0', kind: 'agent_session'});

    expect(parsed.kind).toBe('agent_session');
  });

  it('accepts offset 0', () => {
    const parsed = appendLogsQuerySchema.parse({attempt: '2', offset: '0', kind: 'log_stream'});

    expect(parsed.offset).toBe(0);
  });

  it('rejects a missing kind', () => {
    const parse = () => appendLogsQuerySchema.parse({attempt: '1', offset: '0'});

    expect(parse).toThrow();
  });

  it('rejects an unknown kind', () => {
    const parse = () => appendLogsQuerySchema.parse({attempt: '1', offset: '0', kind: 'diff'});

    expect(parse).toThrow();
  });

  it('rejects attempt below 1', () => {
    const parse = () =>
      appendLogsQuerySchema.parse({attempt: '0', offset: '0', kind: 'log_stream'});

    expect(parse).toThrow();
  });

  it('rejects a negative offset', () => {
    const parse = () =>
      appendLogsQuerySchema.parse({attempt: '1', offset: '-5', kind: 'log_stream'});

    expect(parse).toThrow();
  });

  it('rejects a non-integer offset', () => {
    const parse = () =>
      appendLogsQuerySchema.parse({attempt: '1', offset: '1.5', kind: 'log_stream'});

    expect(parse).toThrow();
  });

  it('rejects an attempt beyond the Postgres integer range', () => {
    const parse = () =>
      appendLogsQuerySchema.parse({attempt: '2147483648', offset: '0', kind: 'log_stream'});

    expect(parse).toThrow();
  });
});

describe('offsetGapResponseSchema', () => {
  it('matches the ClientError wire shape', () => {
    const parsed = offsetGapResponseSchema.parse({
      code: 'offset-gap',
      details: {committed_length: 42},
    });

    expect(parsed).toEqual({code: 'offset-gap', details: {committed_length: 42}});
  });
});
