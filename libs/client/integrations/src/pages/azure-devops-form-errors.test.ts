import {ApiError} from '@shipfox/client-api';
import {azureDevOpsConnectErrorToFormError} from './azure-devops-form-errors.js';

function apiError(code: string, status = 400, message = `${code} server message`) {
  return new ApiError({code, message, status});
}

describe('azureDevOpsConnectErrorToFormError', () => {
  test('routes a rejected token to the token field', () => {
    const result = azureDevOpsConnectErrorToFormError(
      apiError('azure-devops-credential-rejected', 422),
    );

    expect(result).toEqual({
      kind: 'field',
      field: 'token',
      message:
        'Azure DevOps rejected this token. Check the organization, and that the token has Code (read & write) and Pull Request Threads access.',
    });
  });

  test('routes an organization linked elsewhere to the organization field', () => {
    const result = azureDevOpsConnectErrorToFormError(
      apiError('azure-devops-organization-already-linked', 409),
    );

    expect(result).toEqual({
      kind: 'field',
      field: 'organization',
      message: 'That organization is already installed in another workspace.',
    });
  });

  test('routes provider errors to a form-level alert with the server message', () => {
    const result = azureDevOpsConnectErrorToFormError(apiError('rate-limited', 429));

    expect(result).toEqual({kind: 'form', message: 'rate-limited server message'});
  });

  test('never surfaces the raw URL of a network error', () => {
    const result = azureDevOpsConnectErrorToFormError(
      apiError('network-error', 0, 'fetch failed for https://api.example.com/integrations'),
    );

    expect(result).toEqual({
      kind: 'form',
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  });

  test('passes through the message of a plain Error', () => {
    expect(azureDevOpsConnectErrorToFormError(new Error('boom'))).toEqual({
      kind: 'form',
      message: 'boom',
    });
  });

  test('falls back to a generic message for anything else', () => {
    expect(azureDevOpsConnectErrorToFormError('nope')).toEqual({
      kind: 'form',
      message: 'Something went wrong. Try again.',
    });
  });
});
