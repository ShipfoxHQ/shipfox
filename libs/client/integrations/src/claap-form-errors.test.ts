import {ApiError} from '@shipfox/client-api';
import {claapConnectErrorToFormError, claapReplaceErrorToFormError} from './claap-form-errors.js';

function apiError(code: string, status = 400, details?: unknown) {
  return new ApiError({code, status, message: `${code} message`, details});
}

describe('Claap form error mapping', () => {
  test.each([
    ['invalid-api-key-prefix', 'Use a Claap API key that starts with cla_.'],
    [
      'invalid-api-key',
      'Claap did not accept this key. Check that it is active and copied in full.',
    ],
    [
      'unexpected-workspace-count',
      'This key does not belong to exactly one Claap workspace. Create a key in the workspace to connect.',
    ],
    [
      'workspace-mismatch',
      'This key belongs to another Claap workspace. Use a key from the connected workspace.',
    ],
  ])('maps %s to the key field in both forms', (code, message) => {
    const error = apiError(code);
    const expected = {kind: 'field', field: 'apiKey', message};
    expect(claapConnectErrorToFormError(error)).toEqual(expected);
    expect(claapReplaceErrorToFormError(error)).toEqual(expected);
  });

  test.each([
    ['rate-limited', 'Claap received too many requests. Wait a moment and try again.'],
    ['provider-unavailable', 'Claap is unavailable. Try again later.'],
    ['timeout', 'Claap took too long to respond. Try again.'],
    ['malformed-provider-response', 'Claap returned an unexpected response. Try again later.'],
    ['provider-rejected', 'Claap rejected the request. Check the setup guide and try again.'],
    [
      'credential-version-conflict',
      'The API key changed while you were replacing it. Refresh the page and try again.',
    ],
    [
      'not-found',
      'This Claap integration connection is unavailable. Refresh the page and try again.',
    ],
    ['forbidden', 'You do not have permission to manage this integration connection.'],
    ['network-error', "We couldn't reach the server. Check your connection and try again."],
  ])('maps %s to a form error without exposing provider text', (code, message) => {
    expect(claapConnectErrorToFormError(apiError(code))).toEqual({kind: 'form', message});
    expect(claapReplaceErrorToFormError(apiError(code))).toEqual({kind: 'form', message});
  });

  test('extracts the connection from the already-connected response', () => {
    expect(
      claapConnectErrorToFormError(
        apiError('already-connected', 409, {
          code: 'already-connected',
          details: {connection_id: '11111111-1111-4111-8111-111111111111'},
        }),
      ),
    ).toEqual({kind: 'already-connected', connectionId: '11111111-1111-4111-8111-111111111111'});
  });

  test.each([
    {},
    new Error('sensitive provider response'),
    apiError('unknown-server-error'),
    apiError('toString'),
  ])('uses a safe fallback for unknown errors: %j', (error) => {
    const expected = {kind: 'form', message: 'Something went wrong. Try again.'};
    expect(claapConnectErrorToFormError(error)).toEqual(expected);
    expect(claapReplaceErrorToFormError(error)).toEqual(expected);
  });
});
