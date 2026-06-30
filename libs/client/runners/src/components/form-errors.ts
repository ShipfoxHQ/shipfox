import {manualRegistrationTokenErrorMessage} from './manual-registration-token-errors.js';

export type ManualRegistrationTokenCreateFormErrorMapping = {kind: 'form'; message: string};

export function manualRegistrationTokenCreateErrorToFormError(
  error: unknown,
): ManualRegistrationTokenCreateFormErrorMapping {
  return {kind: 'form', message: manualRegistrationTokenErrorMessage(error)};
}
