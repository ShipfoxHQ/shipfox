import {normalizeNotionId} from './notion-id.js';

describe('normalizeNotionId', () => {
  it.each([
    ['a bare ID', '2e6f8a3e0000400080005d2b7e9a1c11', '2e6f8a3e-0000-4000-8000-5d2b7e9a1c11'],
    [
      'a shared page URL',
      'https://www.notion.so/Project-spec-2e6f8a3e0000400080005d2b7e9a1c11',
      '2e6f8a3e-0000-4000-8000-5d2b7e9a1c11',
    ],
    [
      'a workspace page URL with query parameters',
      'https://www.notion.so/acme/Project-spec-2e6f8a3e-0000-4000-8000-5d2b7e9a1c11?source=copy#page',
      '2e6f8a3e-0000-4000-8000-5d2b7e9a1c11',
    ],
    ['a non-UUID test ID', 'page-123', 'page-123'],
  ])('normalizes %s', (_name, input, expected) => {
    expect(normalizeNotionId(input)).toBe(expected);
  });
});
