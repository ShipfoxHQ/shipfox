// @vitest-environment jsdom
import type {BrowserStorage} from '@shipfox/client-ui';
import {
  consumeInstallReturnLocation,
  consumeInstallReturnTarget,
  INSTALL_RETURN_TARGET_KEY,
  parseInstallReturnTarget,
  saveInstallReturnTarget,
} from './install-return-target.js';

function memoryStorage(initial: Record<string, string> = {}): BrowserStorage & {
  entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

describe('consumeInstallReturnTarget', () => {
  test('defaults to settings when nothing was stored', () => {
    expect(consumeInstallReturnTarget(memoryStorage())).toBe('settings');
  });

  test('returns home when it was stored', () => {
    const storage = memoryStorage();
    saveInstallReturnTarget(storage, 'home');

    expect(consumeInstallReturnTarget(storage)).toBe('home');
  });

  test('clears the target after one read', () => {
    const storage = memoryStorage();
    saveInstallReturnTarget(storage, 'home');

    consumeInstallReturnTarget(storage);

    expect(consumeInstallReturnTarget(storage)).toBe('settings');
    expect(storage.entries.size).toBe(0);
  });

  test('falls back to settings for an unknown stored value', () => {
    const storage = memoryStorage({[INSTALL_RETURN_TARGET_KEY]: 'https://evil.test'});

    expect(consumeInstallReturnTarget(storage)).toBe('settings');
    expect(storage.entries.size).toBe(0);
  });

  test('falls back to settings when storage is unavailable', () => {
    expect(consumeInstallReturnTarget(undefined)).toBe('settings');
  });
});

describe('saveInstallReturnTarget', () => {
  test('a later settings install replaces a stale home target', () => {
    const storage = memoryStorage();
    saveInstallReturnTarget(storage, 'home');

    saveInstallReturnTarget(storage, 'settings');

    expect(consumeInstallReturnTarget(storage)).toBe('settings');
  });
});

describe('parseInstallReturnTarget', () => {
  test.each([
    [{returnTo: 'home'}, 'home'],
    [{returnTo: 'settings'}, 'settings'],
    [{}, 'settings'],
    [{returnTo: 'https://evil.test'}, 'settings'],
    [{returnTo: ['home']}, 'settings'],
  ])('reads %j as %s', (search, expected) => {
    expect(parseInstallReturnTarget(search)).toBe(expected);
  });
});

describe('consumeInstallReturnLocation', () => {
  beforeEach(() => window.sessionStorage.clear());

  test('targets the integrations settings page by default', () => {
    expect(consumeInstallReturnLocation('acme')).toEqual({
      to: '/w/$workspaceSlug/settings/integrations',
      params: {workspaceSlug: 'acme'},
      replace: true,
    });
  });

  test('targets the workspace home once, then settings', () => {
    saveInstallReturnTarget(window.sessionStorage, 'home');

    expect(consumeInstallReturnLocation('acme')).toMatchObject({to: '/w/$workspaceSlug'});
    expect(consumeInstallReturnLocation('acme')).toMatchObject({
      to: '/w/$workspaceSlug/settings/integrations',
    });
  });
});
