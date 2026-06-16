import {appendLogsQuerySchema} from './append.js';

describe('appendLogsQuerySchema', () => {
  it('coerces string query params to integers', () => {
    const parsed = appendLogsQuerySchema.parse({attempt: '1', offset: '0'});

    expect(parsed).toEqual({attempt: 1, offset: 0});
  });

  it('accepts offset 0', () => {
    const parsed = appendLogsQuerySchema.parse({attempt: '2', offset: '0'});

    expect(parsed.offset).toBe(0);
  });

  it('rejects attempt below 1', () => {
    const parse = () => appendLogsQuerySchema.parse({attempt: '0', offset: '0'});

    expect(parse).toThrow();
  });

  it('rejects a negative offset', () => {
    const parse = () => appendLogsQuerySchema.parse({attempt: '1', offset: '-5'});

    expect(parse).toThrow();
  });

  it('rejects a non-integer offset', () => {
    const parse = () => appendLogsQuerySchema.parse({attempt: '1', offset: '1.5'});

    expect(parse).toThrow();
  });
});
