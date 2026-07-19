import {JiraAuthorizationScopeMismatchError} from './errors.js';
import {assertJiraAuthorizationScopes, formatJiraOAuthScopes, JIRA_OAUTH_SCOPES} from './scopes.js';

describe('Jira OAuth scopes', () => {
  it('formats the requested classic scopes and accepts both classic and granular site scopes', () => {
    const classic = () => assertJiraAuthorizationScopes(['read:jira-work']);
    const granular = () => assertJiraAuthorizationScopes(['read:issue:jira']);

    expect(formatJiraOAuthScopes()).toBe(JIRA_OAUTH_SCOPES.join(' '));
    expect(classic).not.toThrow();
    expect(granular).not.toThrow();
  });

  it('rejects an unusable accessible-resource scope list', () => {
    const result = () => assertJiraAuthorizationScopes([]);

    expect(result).toThrow(JiraAuthorizationScopeMismatchError);
  });
});
