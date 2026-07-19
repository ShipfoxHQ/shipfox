import {logger} from '@shipfox/node-opentelemetry';
import {JiraAuthorizationScopeMismatchError} from './errors.js';

export const JIRA_OAUTH_SCOPES = [
  'read:jira-work',
  'write:jira-work',
  'read:jira-user',
  'manage:jira-webhook',
  'offline_access',
] as const;

export function formatJiraOAuthScopes(): string {
  return JIRA_OAUTH_SCOPES.join(' ');
}

export function assertJiraAuthorizationScopes(scopes: readonly string[]): void {
  const usableScopes = scopes.filter((scope) => scope.trim().length > 0);
  if (usableScopes.length === 0) throw new JiraAuthorizationScopeMismatchError(['site scopes']);
  logger().info({scopes: usableScopes}, 'Jira site authorization scopes granted');
}
