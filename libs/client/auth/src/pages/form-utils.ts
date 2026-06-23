import {ApiError} from '@shipfox/client-api';

const CONTROL_CHARACTER_RE = /\p{Cc}/u;

interface DisplayNameSchema {
  safeParse: (value: string) => {success: boolean};
}

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';

  if (error.code === 'invalid-credentials') {
    return 'Email or password is incorrect.';
  }
  if (error.code === 'email-not-verified') {
    return 'Verify your email before signing in.';
  }
  if (error.code === 'email-taken') {
    return 'An account already exists for this email.';
  }
  if (error.code === 'token-invalid') {
    return 'This link is invalid or expired.';
  }
  if (error.code === 'network-error') {
    return 'We could not reach the API. Check your connection and try again.';
  }

  return error.message || 'Something went wrong. Try again.';
}

export function displayNameFieldError(
  value: string,
  label: string,
  schema: DisplayNameSchema,
): string | undefined {
  if (schema.safeParse(value).success) return undefined;
  if (CONTROL_CHARACTER_RE.test(value)) return `${label} cannot include line breaks or tabs.`;
  const trimmed = value.trim();
  if (trimmed.length === 0) return `${label} is required.`;
  if (trimmed.length > 255) return `${label} must be 255 characters or fewer.`;
  return `${label} is invalid.`;
}
