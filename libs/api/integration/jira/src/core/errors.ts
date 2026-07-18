export class JiraConnectionNotFoundError extends Error {
  constructor(connectionId: string) {
    super(`Jira integration connection was not found: ${connectionId}`);
    this.name = 'JiraConnectionNotFoundError';
  }
}

export class JiraAccessTokenMissingError extends Error {
  constructor(connectionId: string) {
    super(`Jira access token is missing for connection: ${connectionId}`);
    this.name = 'JiraAccessTokenMissingError';
  }
}

export class JiraInstallationSiteMismatchError extends Error {
  constructor(connectionId: string, cloudId: string) {
    super(
      `Jira connection is already linked to a different site: ${connectionId} (attempted ${cloudId})`,
    );
    this.name = 'JiraInstallationSiteMismatchError';
  }
}
