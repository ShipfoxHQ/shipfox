import {ApiError} from '@shipfox/client-api';
import {giteaConnectErrorToFormError} from './gitea-form-errors.js';

function apiError(code: string, status = 400, message = `${code} server message`) {
  return new ApiError({code, message, status});
}

describe('giteaConnectErrorToFormError', () => {
  test('routes gitea-organization-not-found to the org field', () => {
    const result = giteaConnectErrorToFormError(apiError('gitea-organization-not-found', 404));

    expect(result).toEqual({
      kind: 'field',
      field: 'org',
      message: "We couldn't find that organization on Gitea. Check the name and try again.",
    });
  });

  test('routes gitea-org-already-linked to the org field', () => {
    const result = giteaConnectErrorToFormError(apiError('gitea-org-already-linked', 409));

    expect(result).toEqual({
      kind: 'field',
      field: 'org',
      message: 'That organization is already connected.',
    });
  });

  test('routes provider errors to a form-level alert with the server message', () => {
    const result = giteaConnectErrorToFormError(apiError('rate-limited', 429));

    expect(result).toEqual({kind: 'form', message: 'rate-limited server message'});
  });

  test('hides the raw URL in a network-error behind a friendly form-level message', () => {
    const result = giteaConnectErrorToFormError(apiError('network-error', 0));

    expect(result).toEqual({
      kind: 'form',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  test('routes a non-ApiError to a generic form-level alert', () => {
    const result = giteaConnectErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('falls back for a non-Error value', () => {
    const result = giteaConnectErrorToFormError('nope');

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});
