import {ApiError} from '@shipfox/client-api';
import {
  classifyGithubCallback,
  classifyGithubCallbackError,
  clearGithubInstallWorkspace,
  GITHUB_INSTALL_WORKSPACE_KEY,
  GithubCallbackIncompleteError,
  getGithubCallbackTelemetry,
  parseGithubCallbackSearch,
  readGithubInstallWorkspace,
  resolveGithubRecoveryWorkspace,
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
      missing: ['code', 'installation_id', 'state'],
    });
  });

  test('classifies code and state without an installation as a link landing', () => {
    const search = parseGithubCallbackSearch({code: 'link-code', state: 'link-state'});

    expect(classifyGithubCallback(search)).toEqual({
      kind: 'link',
      params: {code: 'link-code', state: 'link-state'},
    });
  });

  test('returns the sorted missing parameter set without callback values', () => {
    const search = parseGithubCallbackSearch({
      code: 'callback-code',
      installation_id: '42',
      setup_action: 'update',
    });

    expect(classifyGithubCallback(search)).toEqual({
      kind: 'invalid',
      missing: ['state'],
      setupAction: 'update',
    });
  });
});

describe('GitHub callback telemetry', () => {
  test.each([
    [
      'complete',
      {code: 'code', installation_id: 42, state: 'state', setup_action: 'install'},
      true,
      'install',
    ],
    ['request', {setup_action: 'request'}, true, 'request'],
    ['link', {code: 'code', state: 'state'}, true, 'other'],
    ['invalid', {state: 'state'}, true, 'other'],
    ['provider-error', {error: 'access_denied'}, true, 'other'],
  ] as const)('normalizes the %s outcome', (kind, search, authenticated, setupAction) => {
    const parsed = parseGithubCallbackSearch(search);
    const intent = classifyGithubCallback(parsed);

    expect(getGithubCallbackTelemetry(parsed, intent, authenticated)).toMatchObject({
      outcome: kind,
      setup_action: setupAction,
      authenticated,
    });
  });

  test('uses guest as the outcome while preserving safe callback dimensions', () => {
    const search = parseGithubCallbackSearch({
      code: 'secret-code',
      installation_id: '42',
      setup_action: 'unexpected',
    });
    const intent = classifyGithubCallback(search);

    expect(getGithubCallbackTelemetry(search, intent, false)).toEqual({
      outcome: 'guest',
      missing: 'state',
      setup_action: 'other',
      authenticated: false,
    });
    expect(JSON.stringify(getGithubCallbackTelemetry(search, intent, false))).not.toContain(
      'secret-code',
    );
  });

  test('groups incomplete callbacks by the sorted missing set only', () => {
    const error = new GithubCallbackIncompleteError(['state', 'code']);

    expect(error).toMatchObject({
      name: 'GithubCallbackIncompleteError',
      message: 'GitHub callback missing code, state',
    });
    expect(error.message).not.toContain('secret-code');
    expect(error.message).not.toContain('secret-state');
  });
});

describe('GitHub recovery workspace', () => {
  const workspaces = [{id: 'ws-1'}, {id: 'ws-2'}];

  test('prefers the stored workspace while the user is still a member', () => {
    expect(resolveGithubRecoveryWorkspace({storedWorkspaceId: 'ws-2', workspaces})).toBe('ws-2');
  });

  test('ignores a stale hint and falls back to the only membership', () => {
    expect(
      resolveGithubRecoveryWorkspace({storedWorkspaceId: 'gone', workspaces: [{id: 'ws-1'}]}),
    ).toBe('ws-1');
  });

  test('uses the only membership when there is no hint', () => {
    expect(
      resolveGithubRecoveryWorkspace({storedWorkspaceId: undefined, workspaces: [{id: 'ws-1'}]}),
    ).toBe('ws-1');
  });

  test('gives up with several memberships and no usable hint', () => {
    expect(resolveGithubRecoveryWorkspace({storedWorkspaceId: 'gone', workspaces})).toBeUndefined();
    expect(
      resolveGithubRecoveryWorkspace({storedWorkspaceId: undefined, workspaces: []}),
    ).toBeUndefined();
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

  test.each([
    ['invalid-github-link-state', 'Expired GitHub link state', {kind: 'expired'}],
    ['invalid-github-link-state', 'Invalid GitHub link state signature', {kind: 'invalid'}],
    ['github-link-state-actor-mismatch', 'wrong actor', {kind: 'actor-mismatch'}],
    ['github-multiple-linkable-installations', 'many', {kind: 'multiple-linkable'}],
  ])('classifies link failure %s (%s)', (code, message, expected) => {
    const error = new ApiError({code, message, status: 409});

    expect(classifyGithubCallbackError(error)).toEqual(expected);
  });

  test('reads bounded counts from a no-linkable-installation failure', () => {
    const error = new ApiError({
      code: 'github-no-linkable-installation',
      message: 'none',
      status: 409,
      details: {accessible: 3, linked_elsewhere: 2},
    });
    const withoutDetails = new ApiError({
      code: 'github-no-linkable-installation',
      message: 'none',
      status: 409,
    });

    expect(classifyGithubCallbackError(error)).toEqual({
      kind: 'no-linkable',
      accessible: 3,
      linkedElsewhere: 2,
    });
    expect(classifyGithubCallbackError(withoutDetails)).toEqual({
      kind: 'no-linkable',
      accessible: 0,
      linkedElsewhere: 0,
    });
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
