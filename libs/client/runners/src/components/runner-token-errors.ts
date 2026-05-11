import {ApiError} from '@shipfox/client-api';

export function runnerTokenErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Try again.';
}
