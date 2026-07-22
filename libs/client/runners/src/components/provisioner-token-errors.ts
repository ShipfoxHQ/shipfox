import {ApiError} from '@shipfox/client-api';

export function provisionerTokenErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network-error') {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    return error.message;
  }
  return 'Something went wrong. Try again.';
}
