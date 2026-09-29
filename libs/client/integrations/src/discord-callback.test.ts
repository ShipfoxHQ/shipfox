import {
  clearDiscordInstallWorkspace,
  DISCORD_INSTALL_WORKSPACE_KEY,
  parseDiscordCallbackQuery,
  readDiscordInstallWorkspace,
  saveDiscordInstallWorkspace,
  serializeDiscordCallbackQuery,
} from './discord-callback.js';

describe('Discord callback helpers', () => {
  it('parses and serializes success and provider-error queries', () => {
    const success = parseDiscordCallbackQuery({code: 'grant code', state: 'signed state'});
    const providerError = parseDiscordCallbackQuery({
      error: 'access_denied',
      error_description: 'User denied access',
      state: 'signed state',
    });

    expect(success).toEqual({code: 'grant code', state: 'signed state'});
    expect(providerError).toEqual({
      error: 'access_denied',
      error_description: 'User denied access',
      state: 'signed state',
    });
    expect(success && serializeDiscordCallbackQuery(success)).toBe(
      'code=grant+code&state=signed+state',
    );
    expect(providerError && serializeDiscordCallbackQuery(providerError)).toBe(
      'error=access_denied&error_description=User+denied+access&state=signed+state',
    );
  });

  it('rejects callbacks without a state and prefers a grant code', () => {
    expect(parseDiscordCallbackQuery({code: 'grant'})).toBeUndefined();
    expect(parseDiscordCallbackQuery({state: 'signed'})).toBeUndefined();
    expect(
      parseDiscordCallbackQuery({code: 'grant', error: 'access_denied', state: 'signed'}),
    ).toEqual({code: 'grant', state: 'signed'});
  });

  it('round-trips the workspace handoff and tolerates unavailable storage', () => {
    const storage = new Map<string, string>();
    const workspaceStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };

    saveDiscordInstallWorkspace(workspaceStorage, 'workspace-1');
    expect(storage.get(DISCORD_INSTALL_WORKSPACE_KEY)).toBe('workspace-1');
    expect(readDiscordInstallWorkspace(workspaceStorage)).toBe('workspace-1');
    clearDiscordInstallWorkspace(workspaceStorage);
    expect(readDiscordInstallWorkspace(workspaceStorage)).toBeUndefined();

    const unavailableStorage = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('unavailable');
      },
      removeItem: () => {
        throw new Error('unavailable');
      },
    };
    expect(() => saveDiscordInstallWorkspace(unavailableStorage, 'workspace-1')).not.toThrow();
    expect(() => readDiscordInstallWorkspace(unavailableStorage)).not.toThrow();
    expect(() => clearDiscordInstallWorkspace(unavailableStorage)).not.toThrow();
  });
});
