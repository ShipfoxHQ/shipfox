import {displayNameSchema} from './display-name.js';

describe('displayNameSchema', () => {
  it('trims surrounding whitespace', () => {
    const result = displayNameSchema.parse('  Acme Platform  ');

    expect(result).toBe('Acme Platform');
  });

  it('accepts accents and emoji', () => {
    const result = displayNameSchema.parse('Équipe Renard 🚀');

    expect(result).toBe('Équipe Renard 🚀');
  });

  it('accepts 255 characters after trimming', () => {
    const result = displayNameSchema.parse(` ${'a'.repeat(255)} `);

    expect(result).toHaveLength(255);
  });

  it('rejects an empty name after trimming', () => {
    const parse = () => displayNameSchema.parse('   ');

    expect(parse).toThrow();
  });

  it.each([
    ['newline', 'Acme\nPlatform'],
    ['tab', 'Acme\tPlatform'],
    ['NUL', 'Acme\0Platform'],
    ['escape', 'Acme\u001b[31mPlatform'],
  ])('rejects a %s control character', (_name, value) => {
    const parse = () => displayNameSchema.parse(value);

    expect(parse).toThrow('must not contain control characters');
  });

  it('rejects values longer than 255 characters after trimming', () => {
    const parse = () => displayNameSchema.parse('a'.repeat(256));

    expect(parse).toThrow();
  });
});
