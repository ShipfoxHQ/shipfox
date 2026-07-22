import {ApiError} from '@shipfox/client-api';
import {githubCallbackErrorMessage} from './github-callback.js';

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
