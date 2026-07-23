export interface AuthRedirectSearch {
  redirect?: string;
}

export interface PasswordResetSearch {
  token?: string;
}

export function validateRedirectSearch(input: Record<string, unknown>): AuthRedirectSearch {
  const redirect = nonEmptyString(input.redirect);
  return redirect ? {redirect} : {};
}

export function validatePasswordResetSearch(input: Record<string, unknown>): PasswordResetSearch {
  const token = nonEmptyString(input.token);
  return token ? {token} : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
