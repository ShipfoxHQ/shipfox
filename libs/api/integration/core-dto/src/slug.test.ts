import {connectionSlugSchema, slugifyConnectionSlug} from './slug.js';

describe('slugifyConnectionSlug', () => {
  it.each([
    ['GitHub Acme', 'github_acme'],
    ['github_acme', 'github_acme'],
    ['github-acme', 'github_acme'],
    ['  acme  prod  ', 'acme_prod'],
    ['___acme___', 'acme'],
    ['!!!', 'github'],
    ['こんにちは', 'github'],
  ])('normalizes "%s"', (input, expected) => {
    const result = slugifyConnectionSlug(input, {fallback: 'github'});

    expect(result).toBe(expected);
    expect(connectionSlugSchema.safeParse(result).success).toBe(true);
  });
});

describe('connectionSlugSchema', () => {
  it.each(['a-b', 'a_b', 'github_my_org'])('accepts %s', (slug) => {
    const result = connectionSlugSchema.safeParse(slug);

    expect(result.success).toBe(true);
  });

  it.each(['Github', '_x', 'x_', 'a__b', '', 'a'.repeat(101)])('rejects %s', (slug) => {
    const result = connectionSlugSchema.safeParse(slug);

    expect(result.success).toBe(false);
  });
});
