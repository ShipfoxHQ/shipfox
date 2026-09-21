import {ApiError} from '@shipfox/client-api';
import {
  posthogConnectErrorToFormError,
  posthogReplaceErrorToFormError,
} from './posthog-form-errors.js';

function apiError(code: string, status = 400, details?: unknown) {
  return new ApiError({code, status, message: `${code} message`, details});
}

describe('PostHog form error mapping', () => {
  test('maps an invalid key to the API key field', () => {
    expect(posthogConnectErrorToFormError(apiError('invalid-api-key'))).toEqual({
      kind: 'field',
      field: 'apiKey',
      message: 'Use a PostHog personal API key that starts with phx_.',
    });
  });

  test('maps provider permission failures to the API key field', () => {
    expect(posthogConnectErrorToFormError(apiError('provider-rejected'))).toEqual({
      kind: 'field',
      field: 'apiKey',
      message: 'provider-rejected message',
    });
  });

  test('extracts the connection from the already-connected response', () => {
    expect(
      posthogConnectErrorToFormError(
        apiError('already-connected', 409, {
          status: 'already-connected',
          connection_id: '11111111-1111-4111-8111-111111111111',
        }),
      ),
    ).toEqual({
      kind: 'already-connected',
      connectionId: '11111111-1111-4111-8111-111111111111',
    });
  });

  test('maps a replacement project mismatch to the key field', () => {
    expect(posthogReplaceErrorToFormError(apiError('project-mismatch'))).toEqual({
      kind: 'field',
      field: 'apiKey',
      message: 'This key cannot access the connected PostHog project.',
    });
  });

  test('uses a safe message for network failures', () => {
    expect(posthogConnectErrorToFormError(apiError('network-error', 0))).toEqual({
      kind: 'form',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  test('uses a generic fallback for unknown errors', () => {
    expect(posthogReplaceErrorToFormError({})).toEqual({
      kind: 'form',
      message: 'Something went wrong. Try again.',
    });
    expect(posthogReplaceErrorToFormError(apiError('unknown-server-error'))).toEqual({
      kind: 'form',
      message: 'Something went wrong. Try again.',
    });
  });
});
