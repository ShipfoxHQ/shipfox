import {ApiError} from '@shipfox/client-api';
import {
  classifySentryConnectError,
  clearSentryInstallWorkspace,
  parseSentryCallbackParams,
  preselectSentryWorkspace,
  readSentryInstallWorkspace,
  SENTRY_INSTALL_WORKSPACE_KEY,
  saveSentryInstallWorkspace,
} from './sentry-callback.js';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
  };
}

function throwingStorage() {
  return {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('storage disabled');
    },
    removeItem: () => {
      throw new Error('storage disabled');
    },
  };
}

function apiError(params: {code: string; status: number; message?: string; details?: unknown}) {
  return new ApiError({
    message: params.message ?? 'failed',
    code: params.code,
    status: params.status,
    details: params.details,
  });
}

describe('parseSentryCallbackParams', () => {
  test('parses camelCase params with display-only orgSlug', () => {
    const params = parseSentryCallbackParams({
      code: 'the-code',
      installationId: 'install-1',
      orgSlug: 'acme',
    });

    expect(params).toEqual({code: 'the-code', installationId: 'install-1', orgSlug: 'acme'});
  });

  test('accepts snake_case params defensively', () => {
    const params = parseSentryCallbackParams({
      code: 'the-code',
      installation_id: 'install-1',
      org_slug: 'acme',
    });

    expect(params).toEqual({code: 'the-code', installationId: 'install-1', orgSlug: 'acme'});
  });

  test('returns undefined when code is missing', () => {
    const params = parseSentryCallbackParams({installationId: 'install-1'});

    expect(params).toBeUndefined();
  });

  test('returns undefined when installationId is missing or empty', () => {
    const missing = parseSentryCallbackParams({code: 'the-code'});
    const empty = parseSentryCallbackParams({code: 'the-code', installationId: ''});

    expect(missing).toBeUndefined();
    expect(empty).toBeUndefined();
  });
});

describe('preselectSentryWorkspace', () => {
  const workspaces = [
    {id: 'ws-1', name: 'One'},
    {id: 'ws-2', name: 'Two'},
  ];

  test('pre-selects the stored workspace when it is still valid', () => {
    const result = preselectSentryWorkspace('ws-2', workspaces);

    expect(result).toEqual({kind: 'pick', preselectedId: 'ws-2'});
  });

  test('ignores a stale stored workspace id', () => {
    const result = preselectSentryWorkspace('gone', workspaces);

    expect(result).toEqual({kind: 'pick', preselectedId: undefined});
  });

  test('pre-selects a sole workspace without stored evidence', () => {
    const result = preselectSentryWorkspace(undefined, [{id: 'ws-1', name: 'One'}]);

    expect(result).toEqual({kind: 'pick', preselectedId: 'ws-1'});
  });

  test('pre-selects nothing for several workspaces without stored evidence', () => {
    const result = preselectSentryWorkspace(undefined, workspaces);

    expect(result).toEqual({kind: 'pick', preselectedId: undefined});
  });

  test('reports none when the user has no workspace', () => {
    const result = preselectSentryWorkspace('ws-1', []);

    expect(result).toEqual({kind: 'none'});
  });
});

describe('classifySentryConnectError', () => {
  test('409 already-linked is terminal without start-over', () => {
    const result = classifySentryConnectError(
      apiError({code: 'sentry-installation-already-linked', status: 409}),
    );

    expect(result).toEqual({
      kind: 'terminal',
      message: 'This Sentry org is already connected to another workspace.',
      startOver: false,
    });
  });

  test('429 rate-limited is retryable and carries retry_after_seconds', () => {
    const result = classifySentryConnectError(
      apiError({code: 'rate-limited', status: 429, details: {retry_after_seconds: 30}}),
    );

    expect(result).toEqual({
      kind: 'retryable',
      message: 'Sentry is rate limiting requests. Try again in a moment.',
      retryAfterSeconds: 30,
    });
  });

  test.each(['timeout', 'provider-unavailable'])('503 %s is retryable', (code) => {
    const result = classifySentryConnectError(apiError({code, status: 503}));

    expect(result).toEqual({kind: 'retryable', message: 'Sentry is unreachable. Try again.'});
  });

  test.each([
    'access-denied',
    'malformed-provider-response',
  ])('422 %s is terminal with start-over', (code) => {
    const result = classifySentryConnectError(
      apiError({code, status: 422, message: 'Sentry rejected the code.'}),
    );

    expect(result).toEqual({
      kind: 'terminal',
      message: 'Sentry rejected the code.',
      startOver: true,
    });
  });

  test('5xx ApiError falls back to retryable', () => {
    const result = classifySentryConnectError(apiError({code: 'server-error', status: 500}));

    expect(result).toEqual({kind: 'retryable', message: 'Could not connect Sentry. Try again.'});
  });

  test('unknown errors fall back to retryable', () => {
    const result = classifySentryConnectError(new Error('network down'));

    expect(result).toEqual({kind: 'retryable', message: 'Could not connect Sentry. Try again.'});
  });
});

describe('sentry install workspace storage helpers', () => {
  test('round-trips the workspace id', () => {
    const storage = fakeStorage();

    saveSentryInstallWorkspace(storage, 'ws-1');
    const read = readSentryInstallWorkspace(storage);

    expect(read).toBe('ws-1');
    expect(storage.map.get(SENTRY_INSTALL_WORKSPACE_KEY)).toBe('ws-1');
  });

  test('clear removes the key', () => {
    const storage = fakeStorage({[SENTRY_INSTALL_WORKSPACE_KEY]: 'ws-1'});

    clearSentryInstallWorkspace(storage);

    expect(readSentryInstallWorkspace(storage)).toBeUndefined();
  });

  test('helpers swallow storage failures instead of throwing', () => {
    const storage = throwingStorage();

    saveSentryInstallWorkspace(storage, 'ws-1');
    const read = readSentryInstallWorkspace(storage);
    clearSentryInstallWorkspace(storage);

    expect(read).toBeUndefined();
  });
});
