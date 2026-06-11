/**
 * Base for issue deliveries we received and authenticated but deliberately do
 * not publish. The webhook layer records them for dedup and acknowledges with a
 * 204 rather than treating them as failures — a sustained non-2xx can make Sentry
 * disable the webhook. Carries no HTTP concerns so workers/jobs can reuse it.
 */
export class SentryIssueDroppedError extends Error {}

export class SentryInstallationNotFoundError extends SentryIssueDroppedError {
  constructor(public readonly installationUuid: string) {
    super(`Sentry installation not found: ${installationUuid}`);
    this.name = 'SentryInstallationNotFoundError';
  }
}

export class SentryInstallationDeletedError extends SentryIssueDroppedError {
  constructor(public readonly installationUuid: string) {
    super(`Sentry installation is deleted: ${installationUuid}`);
    this.name = 'SentryInstallationDeletedError';
  }
}

export class SentryConnectionNotFoundError extends SentryIssueDroppedError {
  constructor(public readonly connectionId: string) {
    super(`Sentry installation has no connection: ${connectionId}`);
    this.name = 'SentryConnectionNotFoundError';
  }
}
