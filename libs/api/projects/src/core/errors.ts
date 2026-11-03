export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectAccessDeniedError extends Error {
  constructor(projectId: string) {
    super(`Access denied for project: ${projectId}`);
    this.name = 'ProjectAccessDeniedError';
  }
}

export class ProjectAlreadyExistsError extends Error {
  constructor(
    public readonly existingProjectId: string,
    public readonly sourceConnectionId: string,
    public readonly sourceExternalRepositoryId: string,
  ) {
    super(
      `Project already exists for source repository: ${sourceConnectionId}/${sourceExternalRepositoryId}`,
    );
    this.name = 'ProjectAlreadyExistsError';
  }
}

export class ProjectSlugConflictError extends Error {
  constructor(public readonly slug: string) {
    super(`Project slug already exists: ${slug}`);
    this.name = 'ProjectSlugConflictError';
  }
}

export class ProjectSourceChangedError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project source changed: ${projectId}`);
    this.name = 'ProjectSourceChangedError';
  }
}

export type ProjectAccessInvalidReason =
  | 'connection-invalid'
  | 'connection-duplicate'
  | 'resource-kind-unsupported'
  | 'resource-not-found'
  | 'empty-resource-scope'
  | 'access-limit-exceeded';

/** The requested access can't be stored. `reason` says which rule it breaks. */
export class ProjectAccessInvalidError extends Error {
  constructor(
    public readonly reason: ProjectAccessInvalidReason,
    message: string,
    public readonly connectionId?: string | undefined,
  ) {
    super(message);
    this.name = 'ProjectAccessInvalidError';
  }
}

/** The integration provider could not answer while access was validated. */
export class ProjectAccessProviderError extends Error {
  constructor(
    public readonly providerReason: string,
    public readonly retryAfterSeconds?: number | undefined,
  ) {
    super(`Integration provider request failed: ${providerReason}`);
    this.name = 'ProjectAccessProviderError';
  }
}

export class DefaultProjectExistsError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Workspace already has a default project: ${workspaceId}`);
    this.name = 'DefaultProjectExistsError';
  }
}
