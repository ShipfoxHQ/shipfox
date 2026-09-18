import {ApiError} from '@shipfox/client-api';
import {
  classifyGithubCallback,
  classifyGithubCallbackError,
  clearGithubInstallWorkspace,
  GITHUB_INSTALL_WORKSPACE_KEY,
  parseGithubCallbackSearch,
  readGithubInstallWorkspace,
  saveGithubInstallWorkspace,
} from './github-callback.js';

describe('GitHub callback classification', () => {
  test('classifies a request result before requiring completion parameters', () => {
    const search = parseGithubCallbackSearch({
      setup_action: 'request',
      installation_id: 'not-a-number',
    });

    expect(classifyGithubCallback(search)).toEqual({kind: 'request'});
  });

  test('classifies provider errors without retaining malformed completion parameters', () => {
    const search = parseGithubCallbackSearch({
      error: 'access_denied',
      error_description: 'The user denied access',
      code: ['not-a-string'],
      installation_id: '-1',
    });

    expect(search).toEqual({
      error: 'access_denied',
      errorDescription: 'The user denied access',
    });
    expect(classifyGithubCallback(search)).toEqual({kind: 'provider-error'});
  });

  test('accepts only complete direct-install callbacks', () => {
    const complete = parseGithubCallbackSearch({
      code: 'grant-code',
      installation_id: '42',
      state: 'signed-state',
      setup_action: 'install',
    });

    expect(classifyGithubCallback(complete)).toEqual({
      kind: 'complete',
      params: {
        code: 'grant-code',
        installationId: 42,
        state: 'signed-state',
        setupAction: 'install',
      },
    });
    expect(classifyGithubCallback(parseGithubCallbackSearch({state: 7}))).toEqual({
      kind: 'invalid',
    });
  });
});

describe('GitHub callback failures', () => {
  test.each([
    ['Expired GitHub install state', 'expired'],
    ['Invalid GitHub install state signature', 'invalid'],
  ])('classifies state failure %s as %s', (message, kind) => {
    const error = new ApiError({code: 'invalid-github-install-state', message, status: 400});

    expect(classifyGithubCallbackError(error)).toEqual({kind});
  });

  test('classifies actor mismatch and transient provider failures', () => {
    const actorMismatch = new ApiError({
      code: 'github-install-state-actor-mismatch',
      message: 'wrong actor',
      status: 403,
    });
    const providerFailure = new ApiError({
      code: 'provider-unavailable',
      message: 'GET https://api.github.test failed',
      status: 503,
    });

    expect(classifyGithubCallbackError(actorMismatch)).toEqual({kind: 'actor-mismatch'});
    expect(classifyGithubCallbackError(providerFailure)).toEqual({kind: 'provider-error'});
  });

  test.each([
    ['malformed-provider-response', 'provider-error', 422],
    ['provider-rejected', 'provider-error', 422],
    ['access-denied', 'not-authorized', 422],
    ['installation-not-found', 'not-authorized', 422],
    ['not-found', 'workspace-access-changed', 404],
    ['forbidden', 'workspace-access-changed', 403],
    ['workspace-inactive', 'workspace-access-changed', 403],
  ])('classifies callback reason %s as %s', (code, kind, status) => {
    const error = new ApiError({code, message: 'GitHub callback failed', status});

    expect(classifyGithubCallbackError(error)).toEqual({kind});
  });
});

describe('GitHub install workspace storage', () => {
  test('saves, reads, and clears the session-scoped handoff', () => {
    const storage = new Map<string, string>();
    const browserStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };

    saveGithubInstallWorkspace(browserStorage, 'workspace-id');

    expect(storage.get(GITHUB_INSTALL_WORKSPACE_KEY)).toBe('workspace-id');
    expect(readGithubInstallWorkspace(browserStorage)).toBe('workspace-id');

    clearGithubInstallWorkspace(browserStorage);

    expect(readGithubInstallWorkspace(browserStorage)).toBeUndefined();
  });
});
