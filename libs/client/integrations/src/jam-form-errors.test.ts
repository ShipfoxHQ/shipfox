import {ApiError} from '@shipfox/client-api';
import {jamConnectErrorToFormError, jamReplaceErrorToFormError} from './jam-form-errors.js';

function apiError(code: string, status = 400, details?: unknown) {
  return new ApiError({code, status, message: `${code} message`, details});
}

describe('Jam form error mapping', () => {
  test.each([
    ['invalid-token-prefix', 'Use a Jam personal access token that starts with jam_pat_.'],
    ['invalid-token', 'Jam rejected this token. It may have expired or been revoked.'],
    [
      'missing-read-scope',
      'This token has no MCP access. Create a token with MCP read access, not CLI access only.',
    ],
    [
      'mcp-unavailable',
      'Jam did not let this token read Jams over MCP. Check its MCP read access and try again.',
    ],
    [
      'workspace-mismatch',
      'This token belongs to another Jam workspace. Use a token from the connected workspace.',
    ],
  ])('maps %s to the token field in both forms', (code, message) => {
    const error = apiError(code);
    expect(jamConnectErrorToFormError(error)).toEqual({kind: 'field', field: 'token', message});
    expect(jamReplaceErrorToFormError(error)).toEqual({kind: 'field', field: 'token', message});
  });

  test.each([
    ['rate-limited', 'Jam received too many requests. Wait a moment and try again.'],
    ['provider-unavailable', 'Jam is unavailable. Try again later.'],
    ['timeout', 'Jam took too long to respond. Try again.'],
    ['malformed-provider-response', 'Jam returned an unexpected response. Try again later.'],
    ['provider-rejected', 'Jam rejected the request. Check the setup guide and try again.'],
    [
      'credential-version-conflict',
      'The token changed while you were replacing it. Refresh the page and try again.',
    ],
    [
      'not-found',
      'This Jam integration connection is unavailable. Refresh the page and try again.',
    ],
    ['forbidden', 'You do not have permission to manage this integration connection.'],
    ['network-error', "We couldn't reach the server. Check your connection and try again."],
  ])('maps %s to a form error without exposing provider text', (code, message) => {
    expect(jamConnectErrorToFormError(apiError(code))).toEqual({kind: 'form', message});
    expect(jamReplaceErrorToFormError(apiError(code))).toEqual({kind: 'form', message});
  });

  test('extracts the connection from the already-connected response', () => {
    expect(
      jamConnectErrorToFormError(
        apiError('already-connected', 409, {
          code: 'already-connected',
          details: {connection_id: '11111111-1111-4111-8111-111111111111'},
        }),
      ),
    ).toEqual({kind: 'already-connected', connectionId: '11111111-1111-4111-8111-111111111111'});
  });

  test.each([
    apiError('already-connected', 409),
    apiError('already-connected', 409, {code: 'already-connected', details: {connection_id: ''}}),
  ])('keeps the already-connected message when the response names no connection', (error) => {
    expect(jamConnectErrorToFormError(error)).toEqual({
      kind: 'form',
      message:
        'This Jam workspace is already connected. Refresh the page and replace the token on its integration connection.',
    });
  });

  test.each([
    {},
    new Error('sensitive provider response'),
    apiError('unknown-server-error'),
    apiError('toString'),
  ])('uses a safe fallback for unknown errors: %j', (error) => {
    expect(jamConnectErrorToFormError(error)).toEqual({
      kind: 'form',
      message: 'Something went wrong. Try again.',
    });
    expect(jamReplaceErrorToFormError(error)).toEqual({
      kind: 'form',
      message: 'Something went wrong. Try again.',
    });
  });
});
