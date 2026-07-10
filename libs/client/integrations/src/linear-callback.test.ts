import {ApiError} from '@shipfox/client-api';
import {
  classifyLinearCallbackError,
  clearLinearInstallWorkspace,
  LINEAR_INSTALL_WORKSPACE_KEY,
  parseLinearCallbackQuery,
  readLinearInstallWorkspace,
  saveLinearInstallWorkspace,
  serializeLinearCallbackQuery,
} from './linear-callback.js';

describe('Linear callback helpers', () => {
  it('parses and serializes success and provider-error callback queries', () => {
    const success = parseLinearCallbackQuery({code: 'grant code', state: 'signed state'});
    const providerError = parseLinearCallbackQuery({
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
    expect(success && serializeLinearCallbackQuery(success)).toBe(
      'code=grant+code&state=signed+state',
    );
    expect(providerError && serializeLinearCallbackQuery(providerError)).toBe(
      'error=access_denied&error_description=User+denied+access&state=signed+state',
    );
  });

  it('rejects malformed callback queries', () => {
    expect(parseLinearCallbackQuery({code: 'grant'})).toBeUndefined();
    expect(parseLinearCallbackQuery({state: 'signed'})).toBeUndefined();
    expect(parseLinearCallbackQuery({error: 'access_denied'})).toBeUndefined();
    expect(parseLinearCallbackQuery({state: ['a', 'b']})).toBeUndefined();
    expect(parseLinearCallbackQuery({code: '', state: ''})).toBeUndefined();
  });

  it('prefers the grant code when a callback carries both code and error', () => {
    const parsed = parseLinearCallbackQuery({
      code: 'grant',
      error: 'access_denied',
      state: 'signed',
    });

    expect(parsed).toEqual({code: 'grant', state: 'signed'});
  });

  it('round-trips workspace navigation storage and swallows storage errors', () => {
    const storage = new Map<string, string>();
    const workspaceStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };

    saveLinearInstallWorkspace(workspaceStorage, 'workspace-1');
    expect(storage.get(LINEAR_INSTALL_WORKSPACE_KEY)).toBe('workspace-1');
    expect(readLinearInstallWorkspace(workspaceStorage)).toBe('workspace-1');
    clearLinearInstallWorkspace(workspaceStorage);
    expect(readLinearInstallWorkspace(workspaceStorage)).toBeUndefined();

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
    expect(() => saveLinearInstallWorkspace(unavailableStorage, 'workspace-1')).not.toThrow();
    expect(() => readLinearInstallWorkspace(unavailableStorage)).not.toThrow();
    expect(() => clearLinearInstallWorkspace(unavailableStorage)).not.toThrow();
  });

  it.each([
    ['invalid-linear-install-state', 400, true, false],
    ['linear-install-state-actor-mismatch', 403, true, true],
    ['linear-installation-already-linked', 409, false, false],
    ['linear-connection-already-linked', 409, false, false],
    ['linear-authorization-scope-mismatch', 422, true, false],
    ['linear-oauth-callback-error', 422, true, false],
    ['unauthorized', 401, true, true],
    ['provider-unavailable', 503, true, false],
    ['timeout', 503, true, false],
    ['rate-limited', 429, true, false],
    ['network-error', 0, true, false],
    ['slug-conflict', 409, true, false],
    ['unknown-error', 400, true, false],
  ])('classifies %s without retrying the callback code', (code, status, startOver, signIn) => {
    const failure = classifyLinearCallbackError(
      new ApiError({code, message: 'request failed', status}),
    );

    expect(failure.startOver).toBe(startOver);
    expect(failure.signIn).toBe(signIn);
  });
});
