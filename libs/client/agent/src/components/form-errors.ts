import {ApiError} from '@shipfox/client-api';

export type AgentProviderConfigFormErrorMapping = {kind: 'form'; message: string};

type ProviderErrorDetails = {
  message?: unknown;
  provider_id?: unknown;
  expected_keys?: unknown;
  details?: unknown;
};

export function agentProviderConfigErrorToFormError(
  error: unknown,
): AgentProviderConfigFormErrorMapping {
  if (error instanceof ApiError) {
    return {kind: 'form', message: apiErrorMessage(error)};
  }
  if (error instanceof Error) {
    return {kind: 'form', message: error.message};
  }
  return {kind: 'form', message: 'Something went wrong. Try again.'};
}

function apiErrorMessage(error: ApiError): string {
  const details = providerErrorDetails(error.details);

  if (error.code === 'provider-validation-failed') {
    return typeof details.message === 'string' ? details.message : error.message;
  }
  if (error.code === 'invalid-credential-fields') {
    const expectedKeys = Array.isArray(details.expected_keys)
      ? details.expected_keys.filter((key): key is string => typeof key === 'string')
      : [];
    if (expectedKeys.length > 0) {
      return `Credentials must include exactly these fields: ${expectedKeys.join(', ')}.`;
    }
    return 'Credentials do not match the fields required by this provider.';
  }
  if (error.code === 'invalid-agent-model') {
    return 'Choose a model supported by this provider.';
  }
  if (error.code === 'provider-unsupported') {
    return 'This provider is not supported for workspace-managed credentials.';
  }
  if (error.code === 'provider-not-configured') {
    return 'Configure this provider before setting it as the default.';
  }
  return error.message;
}

function providerErrorDetails(rawDetails: unknown): ProviderErrorDetails {
  if (typeof rawDetails !== 'object' || rawDetails === null) return {};

  const payload = rawDetails as ProviderErrorDetails;
  if (typeof payload.details === 'object' && payload.details !== null) {
    return payload.details as ProviderErrorDetails;
  }
  return payload;
}
