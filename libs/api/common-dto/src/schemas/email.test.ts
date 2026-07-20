import {emailSchema} from './email.js';

describe('emailSchema', () => {
  it('trims surrounding whitespace', () => {
    const result = emailSchema.parse('  user@example.com  ');

    expect(result).toBe('user@example.com');
  });

  it('lowercases the address', () => {
    const result = emailSchema.parse('User@Example.COM');

    expect(result).toBe('user@example.com');
  });

  it('preserves dots in the local part', () => {
    const result = emailSchema.parse('First.Last@example.com');

    expect(result).toBe('first.last@example.com');
  });

  it('preserves plus-addressing', () => {
    const result = emailSchema.parse('user+tag@example.com');

    expect(result).toBe('user+tag@example.com');
  });

  it('preserves provider-specific aliases unchanged', () => {
    const result = emailSchema.parse('u.s.e.r+alias@googlemail.com');

    expect(result).toBe('u.s.e.r+alias@googlemail.com');
  });

  it('rejects a blank value', () => {
    const parse = () => emailSchema.parse('   ');

    expect(parse).toThrow();
  });

  it('rejects invalid email syntax', () => {
    const parse = () => emailSchema.parse('not-an-email');

    expect(parse).toThrow();
  });

  it('accepts a 254-character address after normalization', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`;

    const result = emailSchema.parse(email);

    expect(email).toHaveLength(254);
    expect(result).toBe(email);
  });

  it('rejects a 255-character address after normalization', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(186)}.com`;

    const parse = () => emailSchema.parse(email);

    expect(email).toHaveLength(255);
    expect(parse).toThrow();
  });
});
