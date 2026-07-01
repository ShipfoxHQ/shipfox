import {ApiError} from '@shipfox/client-api';

export function manualRegistrationTokenErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // `network-error` carries the raw request URL in its message; never surface it.
    if (error.code === 'network-error') {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Try again.';
}
