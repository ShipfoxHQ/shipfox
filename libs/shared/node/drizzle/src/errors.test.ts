import {isUniqueViolation} from './errors.js';

describe('isUniqueViolation', () => {
  it('finds a matching PostgreSQL unique violation in an error cause chain', () => {
    const error = new Error('Database operation failed', {
      cause: {code: '23505', constraint: 'unique_constraint'},
    });

    expect(isUniqueViolation(error, 'unique_constraint')).toBe(true);
  });

  it('returns false for another constraint, error code, or cyclic cause', () => {
    const cyclic = {code: '23505', constraint: 'another_constraint'} as {
      code: string;
      constraint: string;
      cause?: unknown;
    };
    cyclic.cause = cyclic;

    expect(isUniqueViolation(cyclic, 'unique_constraint')).toBe(false);
    expect(
      isUniqueViolation({code: '23503', constraint: 'unique_constraint'}, 'unique_constraint'),
    ).toBe(false);
  });
});
