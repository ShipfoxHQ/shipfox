import {SlackAuthorizationScopeMismatchError} from './errors.js';

export const SLACK_BOT_SCOPES = Object.freeze([
  'app_mentions:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'chat:write',
  'chat:write.customize',
  'assistant:write',
  'channels:history',
  'groups:history',
  'channels:read',
  'groups:read',
  'users:read',
  'reactions:read',
  'reactions:write',
  'canvases:read',
  'canvases:write',
  'commands',
]);

export function formatSlackBotScopes(scopes = SLACK_BOT_SCOPES): string {
  return scopes.join(',');
}

/** The required scopes a grant lacks. An installation from before a scope was added lacks it. */
export function missingSlackBotScopes(scopes: readonly string[]): string[] {
  const grantedScopes = new Set(scopes);
  return SLACK_BOT_SCOPES.filter((scope) => !grantedScopes.has(scope));
}

export function assertSlackAuthorizationScopes(scopes: string[]): void {
  const missingScopes = missingSlackBotScopes(scopes);
  if (missingScopes.length > 0) throw new SlackAuthorizationScopeMismatchError(missingScopes);
}
