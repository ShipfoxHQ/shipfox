import {hasCredentialSettings, PROVIDER_CATALOG} from './provider-catalog.js';

describe('PROVIDER_CATALOG', () => {
  test('contains route entries for github, sentry, and gitea', () => {
    expect(PROVIDER_CATALOG.github).toMatchObject({
      kind: 'redirect-install',
      displayName: 'GitHub',
      setupPath: '/w/$workspaceSlug/integrations/github',
    });
    expect(PROVIDER_CATALOG.sentry).toMatchObject({
      kind: 'redirect-install',
      setupPath: '/w/$workspaceSlug/integrations/sentry',
    });
    expect(PROVIDER_CATALOG.linear).toMatchObject({
      kind: 'redirect-install',
      iconName: 'linear',
      setupPath: '/w/$workspaceSlug/integrations/linear',
    });
    expect(PROVIDER_CATALOG.jira).toMatchObject({
      kind: 'redirect-install',
      iconName: 'jira',
      setupPath: '/w/$workspaceSlug/integrations/jira',
    });
    expect(PROVIDER_CATALOG.clickup).toMatchObject({
      kind: 'redirect-install',
      displayName: 'ClickUp',
      iconName: 'clickup',
      setupPath: '/w/$workspaceSlug/integrations/clickup',
    });
    expect(PROVIDER_CATALOG.notion).toMatchObject({
      kind: 'redirect-install',
      displayName: 'Notion',
      iconName: 'notion',
      setupPath: '/w/$workspaceSlug/integrations/notion',
    });
    expect(PROVIDER_CATALOG.discord).toMatchObject({
      kind: 'redirect-install',
      displayName: 'Discord',
      iconName: 'discord',
      setupPath: '/w/$workspaceSlug/integrations/discord',
    });
    expect(PROVIDER_CATALOG.gitea).toMatchObject({
      kind: 'direct-connect',
      setupPath: '/w/$workspaceSlug/integrations/gitea',
    });
  });

  test('marks providers with the install behavior their pages implement', () => {
    expect(PROVIDER_CATALOG.github?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.sentry?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.linear?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.jira?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.clickup?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.notion?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.discord?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.gitea?.kind).toBe('direct-connect');
    expect(PROVIDER_CATALOG.webhook?.kind).toBe('modal-connect');
    expect(PROVIDER_CATALOG.posthog?.kind).toBe('modal-connect');
    expect(PROVIDER_CATALOG.claap?.kind).toBe('modal-connect');
  });

  test('declares webhook as a modal provider with the remixicon webhook icon', () => {
    expect(PROVIDER_CATALOG.webhook).toEqual({
      kind: 'modal-connect',
      displayName: 'Webhook',
      iconName: 'webhookLine',
    });
  });

  test('declares PostHog as a modal provider with its custom icon', () => {
    expect(PROVIDER_CATALOG.posthog).toEqual({
      kind: 'modal-connect',
      displayName: 'PostHog',
      iconName: 'posthog',
      credentialSettings: true,
    });
  });

  test('declares Jam as a modal provider with its custom icon', () => {
    expect(PROVIDER_CATALOG.jam).toEqual({
      kind: 'modal-connect',
      displayName: 'Jam',
      iconName: 'jam',
      credentialSettings: true,
    });
  });

  test('declares Claap as a modal provider with its custom icon', () => {
    expect(PROVIDER_CATALOG.claap).toEqual({
      kind: 'modal-connect',
      displayName: 'Claap',
      iconName: 'claap',
      credentialSettings: true,
    });
  });

  test('gives a credential settings page only to providers connected with a pasted credential', () => {
    expect(hasCredentialSettings('jam')).toBe(true);
    expect(hasCredentialSettings('posthog')).toBe(true);
    expect(hasCredentialSettings('claap')).toBe(true);
    expect(hasCredentialSettings('webhook')).toBe(false);
    expect(hasCredentialSettings('github')).toBe(false);
    expect(hasCredentialSettings('gitlab')).toBe(false);
  });

  test('returns undefined for unknown providers (gallery filter behavior)', () => {
    expect(PROVIDER_CATALOG.gitlab).toBeUndefined();
  });
});
