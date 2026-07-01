import {ApiError} from '@shipfox/client-api';

export type WebhookCreateField = 'slug';

export type WebhookCreateFormErrorMapping =
  | {kind: 'field'; field: WebhookCreateField; message: string}
  | {kind: 'form'; message: string};

export function webhookCreateErrorToFormError(error: unknown): WebhookCreateFormErrorMapping {
  const code = error instanceof ApiError ? error.code : undefined;

  if (code === 'slug-already-exists') {
    return {
      kind: 'field',
      field: 'slug',
      message: 'A webhook with this slug already exists.',
    };
  }

  return {kind: 'form', message: webhookCreateErrorMessage(error)};
}

function webhookCreateErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network-error') {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Try again.';
}
