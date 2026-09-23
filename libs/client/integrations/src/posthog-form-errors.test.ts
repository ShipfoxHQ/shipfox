import {ApiError} from '@shipfox/client-api';
import {
  posthogConnectErrorToFormError,
  posthogReplaceErrorToFormError,
} from './posthog-form-errors.js';

function apiError(code: string, status = 400, details?: unknown) {
  return new ApiError({code, status, message: `${code} message`, details});
}

describe('PostHog form error mapping', () => {
  test.each([
    ['invalid-api-key-prefix', 'Use a PostHog personal API key that starts with phx_.'],
    [
      'credentials-unavailable',
      'PostHog rejected this key. Check the region and use an active personal API key.',
    ],
    [
      'access-denied',
      'PostHog denied access. Check the key permissions and the service user’s project access.',
    ],
    [
      'missing-required-scopes',
      'This key is missing required read scopes. Add the ten scopes listed in the PostHog setup guide.',
    ],
    ['no-project-access', 'This key cannot access any PostHog projects. Check its project access.'],
    [
      'project-not-accessible',
      'This key cannot access the selected PostHog project. Check its project access.',
    ],
    ['project-mismatch', 'This key cannot access the connected PostHog project.'],
  ])('maps %s to the key field in both forms', (code, message) => {
    const error = apiError(code);
    expect(posthogConnectErrorToFormError(error)).toEqual({
      kind: 'field',
      field: 'apiKey',
      message,
    });
    expect(posthogReplaceErrorToFormError(error)).toEqual({
      kind: 'field',
      field: 'apiKey',
      message,
    });
  });

  test.each([
    ['rate-limited', 'PostHog received too many requests. Wait a moment and try again.'],
    ['provider-unavailable', 'PostHog is unavailable. Try again later.'],
    ['timeout', 'PostHog took too long to respond. Try again.'],
    ['malformed-provider-response', 'PostHog returned an unexpected response. Try again later.'],
    ['provider-rejected', 'PostHog rejected the request. Check the setup guide and try again.'],
    [
      'credential-version-conflict',
      'The API key changed while you were replacing it. Refresh the page and try again.',
    ],
    [
      'not-found',
      'This PostHog integration connection is unavailable. Refresh the page and try again.',
    ],
    ['forbidden', 'You do not have permission to manage this integration connection.'],
    ['network-error', "We couldn't reach the server. Check your connection and try again."],
  ])('maps %s to an actionable form error without exposing provider text', (code, message) => {
    expect(posthogConnectErrorToFormError(apiError(code))).toEqual({kind: 'form', message});
    expect(posthogReplaceErrorToFormError(apiError(code))).toEqual({kind: 'form', message});
  });

  test('extracts the connection from the already-connected response', () => {
    expect(
      posthogConnectErrorToFormError(
        apiError('already-connected', 409, {
          code: 'already-connected',
          details: {connection_id: '11111111-1111-4111-8111-111111111111'},
        }),
      ),
    ).toEqual({
      kind: 'already-connected',
      connectionId: '11111111-1111-4111-8111-111111111111',
    });
  });

  test.each([
    {},
    new Error('sensitive provider response'),
    apiError('unknown-server-error'),
    apiError('toString'),
  ])('uses a safe fallback for unknown errors: %j', (error) => {
    expect(posthogConnectErrorToFormError(error)).toEqual({
      kind: 'form',
      message: 'Something went wrong. Try again.',
    });
    expect(posthogReplaceErrorToFormError(error)).toEqual({
      kind: 'form',
      message: 'Something went wrong. Try again.',
    });
  });
});
