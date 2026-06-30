import {redactHeaders} from './constants.js';

describe('redactHeaders', () => {
  it('keeps allowlisted headers and redacts every other value', () => {
    const result = redactHeaders({
      'content-type': 'application/json',
      'user-agent': 'test-agent',
      'x-delivery-id': 'delivery-1',
      authorization: 'Bearer secret',
      cookie: 'sid=secret',
      'x-custom-secret': ['one', 'two'],
    });

    expect(result).toEqual({
      'content-type': 'application/json',
      'user-agent': 'test-agent',
      'x-delivery-id': 'delivery-1',
      authorization: '[redacted]',
      cookie: '[redacted]',
      'x-custom-secret': '[redacted]',
    });
  });
});
