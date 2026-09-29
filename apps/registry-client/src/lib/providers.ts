const PROVIDER_LABELS: Record<string, string> = {
  clickup: 'ClickUp',
  gitea: 'Gitea',
  github: 'GitHub',
  jira: 'Jira',
  linear: 'Linear',
  notion: 'Notion',
  posthog: 'PostHog',
  sentry: 'Sentry',
  shipfox: 'Shipfox',
  slack: 'Slack',
  webhook: 'Webhook',
};

/** The display name of an integration provider; an unknown one keeps its id. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
