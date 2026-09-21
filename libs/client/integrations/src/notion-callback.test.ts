import {
  clearNotionInstallWorkspace,
  NOTION_INSTALL_WORKSPACE_KEY,
  parseNotionCallbackQuery,
  readNotionInstallWorkspace,
  saveNotionInstallWorkspace,
  serializeNotionCallbackQuery,
} from './notion-callback.js';

describe('Notion callback helpers', () => {
  it('parses and serializes success and provider-error queries', () => {
    const success = parseNotionCallbackQuery({code: 'grant code', state: 'signed state'});
    const providerError = parseNotionCallbackQuery({
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
    expect(success && serializeNotionCallbackQuery(success)).toBe(
      'code=grant+code&state=signed+state',
    );
    expect(providerError && serializeNotionCallbackQuery(providerError)).toBe(
      'error=access_denied&error_description=User+denied+access&state=signed+state',
    );
  });

  it('rejects callbacks without a state and prefers a grant code', () => {
    expect(parseNotionCallbackQuery({code: 'grant'})).toBeUndefined();
    expect(parseNotionCallbackQuery({state: 'signed'})).toBeUndefined();
    expect(
      parseNotionCallbackQuery({code: 'grant', error: 'access_denied', state: 'signed'}),
    ).toEqual({code: 'grant', state: 'signed'});
  });

  it('round-trips the workspace handoff and tolerates unavailable storage', () => {
    const storage = new Map<string, string>();
    const workspaceStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };

    saveNotionInstallWorkspace(workspaceStorage, 'workspace-1');
    expect(storage.get(NOTION_INSTALL_WORKSPACE_KEY)).toBe('workspace-1');
    expect(readNotionInstallWorkspace(workspaceStorage)).toBe('workspace-1');
    clearNotionInstallWorkspace(workspaceStorage);
    expect(readNotionInstallWorkspace(workspaceStorage)).toBeUndefined();

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
    expect(() => saveNotionInstallWorkspace(unavailableStorage, 'workspace-1')).not.toThrow();
    expect(() => readNotionInstallWorkspace(unavailableStorage)).not.toThrow();
    expect(() => clearNotionInstallWorkspace(unavailableStorage)).not.toThrow();
  });
});
