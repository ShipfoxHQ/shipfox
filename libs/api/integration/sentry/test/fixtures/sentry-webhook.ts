// Raw Sentry webhook payloads, shaped exactly as Sentry delivers them over the
// wire. Tests serialize these to build signed request bodies; the route parses
// and validates them with the production Zod schema.

export interface SentryIssueWebhookOptions {
  action: string;
  installationUuid: string;
  issue?: Record<string, unknown>;
}

export function sentryIssueWebhook(options: SentryIssueWebhookOptions) {
  return {
    action: options.action,
    installation: {uuid: options.installationUuid},
    data: {
      issue: {
        id: 'issue-123',
        shortId: 'PROJ-1',
        title: 'TypeError: boom',
        culprit: 'app/main',
        level: 'error',
        status: 'unresolved',
        platform: 'javascript',
        web_url: 'https://sentry.io/organizations/acme/issues/123/',
        url: 'https://sentry.io/api/0/issues/123/',
        project_url: 'https://sentry.io/api/0/projects/acme/web/',
        firstSeen: '2026-06-01T00:00:00Z',
        lastSeen: '2026-06-10T00:00:00Z',
        ...options.issue,
      },
    },
  };
}

export interface SentryInstallationWebhookOptions {
  action: string;
  installationUuid: string;
}

export function sentryInstallationWebhook(options: SentryInstallationWebhookOptions) {
  return {
    action: options.action,
    installation: {uuid: options.installationUuid},
  };
}
