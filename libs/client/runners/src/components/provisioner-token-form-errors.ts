import {provisionerTokenErrorMessage} from './provisioner-token-errors.js';

export type ProvisionerTokenCreateFormErrorMapping = {kind: 'form'; message: string};

export function provisionerTokenCreateErrorToFormError(
  error: unknown,
): ProvisionerTokenCreateFormErrorMapping {
  return {kind: 'form', message: provisionerTokenErrorMessage(error)};
}
