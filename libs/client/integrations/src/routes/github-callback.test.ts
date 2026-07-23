import {ApiError} from '@shipfox/client-api';
import {
  githubCallbackErrorMessage,
  githubCallbackParams,
  missingCallbackParams,
  validateGithubCallbackSearch,
} from './github-callback.js';

describe('githubCallbackErrorMessage', () => {
  it('does not expose an API error message or request URL', () => {
    const error = new ApiError({
      code: 'request-failed',
      message: 'GET https://api.example.test/integrations/github/callback failed',
      status: 500,
    });

    const message = githubCallbackErrorMessage(error);

    expect(message).toBe('GitHub could not be installed. Try again from settings.');
    expect(message).not.toContain('https://');
  });
});

describe('github callback route inputs', () => {
  it('normalizes valid values and reports missing or malformed inputs', () => {
    const search = validateGithubCallbackSearch({
      code: 'grant-code',
      installation_id: '42',
      state: 'signed-state',
      setup_action: 'install',
    });

    expect(search).toEqual({
      code: 'grant-code',
      installationId: 42,
      state: 'signed-state',
      setupAction: 'install',
    });
    expect(githubCallbackParams(search)).toEqual({
      code: 'grant-code',
      installationId: 42,
      state: 'signed-state',
      setupAction: 'install',
    });
    expect(missingCallbackParams(validateGithubCallbackSearch({code: ['bad'], state: 7}))).toEqual([
      'code',
      'installation_id',
      'state',
    ]);
  });
});
