import {runnerTokenErrorMessage} from './runner-token-errors.js';

export type RunnerTokenCreateFormErrorMapping = {kind: 'form'; message: string};

export function runnerTokenCreateErrorToFormError(
  error: unknown,
): RunnerTokenCreateFormErrorMapping {
  return {kind: 'form', message: runnerTokenErrorMessage(error)};
}
