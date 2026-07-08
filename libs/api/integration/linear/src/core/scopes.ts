import {LinearAuthorizationScopeMismatchError} from './errors.js';

export const LINEAR_OAUTH_SCOPES = Object.freeze([
  'read',
  'write',
  'app:assignable',
  'app:mentionable',
]);

export function formatLinearOAuthScopes(scopes = LINEAR_OAUTH_SCOPES): string {
  return scopes.join(',');
}

export function assertLinearAuthorizationScopes(scopes: string[]): void {
  const grantedScopes = new Set(scopes);
  const missingScopes = LINEAR_OAUTH_SCOPES.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) throw new LinearAuthorizationScopeMismatchError(missingScopes);
}
