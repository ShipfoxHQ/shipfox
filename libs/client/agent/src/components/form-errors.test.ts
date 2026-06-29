import {ApiError} from '@shipfox/client-api';
import {agentProviderConfigErrorToFormError} from './form-errors.js';

describe('agentProviderConfigErrorToFormError', () => {
  test.each([
    [
      new ApiError({
        code: 'provider-validation-failed',
        message: 'Validation failed',
        status: 422,
        details: {provider_id: 'anthropic', message: 'Provider rejected the key.'},
      }),
      'Provider rejected the key.',
    ],
    [
      new ApiError({
        code: 'provider-validation-failed',
        message: 'Validation failed',
        status: 422,
        details: {
          code: 'provider-validation-failed',
          message: 'Validation failed',
          details: {provider_id: 'anthropic', message: 'Provider rejected the key.'},
        },
      }),
      'Provider rejected the key.',
    ],
    [
      new ApiError({
        code: 'provider-validation-failed',
        message: 'Validation failed',
        status: 422,
      }),
      'Validation failed',
    ],
    [
      new ApiError({
        code: 'invalid-credential-fields',
        message: 'Invalid credentials',
        status: 422,
        details: {provider_id: 'azure-openai-responses', expected_keys: ['endpoint', 'api_key']},
      }),
      'Credentials must include exactly these fields: endpoint, api_key.',
    ],
    [
      new ApiError({
        code: 'invalid-credential-fields',
        message: 'Invalid credentials',
        status: 422,
      }),
      'Credentials do not match the fields required by this provider.',
    ],
    [
      new ApiError({
        code: 'provider-unsupported',
        message: 'Unsupported',
        status: 422,
        details: {provider_id: 'amazon-bedrock'},
      }),
      'This provider is not supported for workspace-managed credentials.',
    ],
    [
      new ApiError({
        code: 'invalid-agent-model',
        message: 'Invalid agent model',
        status: 422,
        details: {provider_id: 'anthropic', model: 'missing-model'},
      }),
      'Choose a model supported by this provider.',
    ],
    [
      new ApiError({
        code: 'provider-not-configured',
        message: 'Not configured',
        status: 422,
        details: {provider_id: 'openai'},
      }),
      'Configure this provider before setting it as the default.',
    ],
    [
      new ApiError({code: 'not-found', message: 'Provider config not found', status: 404}),
      'Provider config not found',
    ],
    [new ApiError({code: 'unknown-code', message: 'Server copy', status: 422}), 'Server copy'],
  ])('maps ApiError %s to a form-level alert', (error, expectedMessage) => {
    const result = agentProviderConfigErrorToFormError(error);

    expect(result).toEqual({kind: 'form', message: expectedMessage});
  });

  test('routes Error to a form-level alert with the error message', () => {
    const result = agentProviderConfigErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('falls back to generic copy for non-Error throwables', () => {
    const result = agentProviderConfigErrorToFormError('weird');

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });
});
