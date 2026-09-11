import {
  CLICKUP_INSTALL_WORKSPACE_KEY,
  clearClickUpInstallWorkspace,
  parseClickUpCallbackQuery,
  readClickUpInstallWorkspace,
  saveClickUpInstallWorkspace,
  serializeClickUpCallbackQuery,
} from './clickup-callback.js';

describe('ClickUp callback helpers', () => {
  it('parses and serializes success and provider-error queries', () => {
    const success = parseClickUpCallbackQuery({code: 'grant code', state: 'signed state'});
    const providerError = parseClickUpCallbackQuery({
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
    expect(success && serializeClickUpCallbackQuery(success)).toBe(
      'code=grant+code&state=signed+state',
    );
    expect(providerError && serializeClickUpCallbackQuery(providerError)).toBe(
      'error=access_denied&error_description=User+denied+access&state=signed+state',
    );
  });

  it('rejects callbacks without a state and prefers a grant code', () => {
    expect(parseClickUpCallbackQuery({code: 'grant'})).toBeUndefined();
    expect(parseClickUpCallbackQuery({state: 'signed'})).toBeUndefined();
    expect(
      parseClickUpCallbackQuery({code: 'grant', error: 'access_denied', state: 'signed'}),
    ).toEqual({code: 'grant', state: 'signed'});
  });

  it('round-trips the workspace handoff and tolerates unavailable storage', () => {
    const storage = new Map<string, string>();
    const workspaceStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };

    saveClickUpInstallWorkspace(workspaceStorage, 'workspace-1');
    expect(storage.get(CLICKUP_INSTALL_WORKSPACE_KEY)).toBe('workspace-1');
    expect(readClickUpInstallWorkspace(workspaceStorage)).toBe('workspace-1');
    clearClickUpInstallWorkspace(workspaceStorage);
    expect(readClickUpInstallWorkspace(workspaceStorage)).toBeUndefined();

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
    expect(() => saveClickUpInstallWorkspace(unavailableStorage, 'workspace-1')).not.toThrow();
    expect(() => readClickUpInstallWorkspace(unavailableStorage)).not.toThrow();
    expect(() => clearClickUpInstallWorkspace(unavailableStorage)).not.toThrow();
  });
});
