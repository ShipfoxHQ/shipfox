import {sanitizeRedirectPath} from './redirect-target.js';

describe('sanitizeRedirectPath', () => {
  describe.each([
    ['simple absolute path', '/foo'],
    ['nested workspace path', '/workspaces/abc/projects/xyz'],
    ['path with search', '/foo?bar=1'],
    ['path with hash', '/foo#hash'],
    ['path with search and hash', '/workspaces/abc?tab=runs#header'],
  ])('accepts %s', (_label, input) => {
    test('returns the original string', () => {
      const result = sanitizeRedirectPath(input);

      expect(result).toBe(input);
    });
  });

  describe.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['empty string', ''],
    ['no leading slash', 'foo'],
    ['protocol-relative URL', '//evil.com'],
    ['triple-slash URL', '///evil.com'],
    ['absolute https URL', 'https://evil.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['plain /auth/login', '/auth/login'],
    ['/auth bare', '/auth'],
    ['/auth/reset with token', '/auth/reset?token=x'],
    ['/auth with query bypass', '/auth?token=x'],
    ['/auth with fragment bypass', '/auth#foo'],
  ])('rejects %s', (_label, input) => {
    test('returns undefined', () => {
      const result = sanitizeRedirectPath(input);

      expect(result).toBeUndefined();
    });
  });

  describe('decode-then-check defenses', () => {
    test('rejects percent-encoded /auth/* path', () => {
      const result = sanitizeRedirectPath('/%61uth/login');

      expect(result).toBeUndefined();
    });

    test('rejects percent-encoded protocol-relative URL', () => {
      const result = sanitizeRedirectPath('/%2fevil.com');

      expect(result).toBeUndefined();
    });

    test('rejects malformed percent-encoded input', () => {
      const result = sanitizeRedirectPath('/%E0%80%80');

      expect(result).toBeUndefined();
    });
  });
});
