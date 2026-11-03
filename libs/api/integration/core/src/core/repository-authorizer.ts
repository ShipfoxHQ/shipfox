import {
  isSafeExternalRepositoryValue,
  isSafeRepositoryPart,
} from '@shipfox/api-integration-core-dto';
import {repositoryAuthorizationErrorCodes} from '@shipfox/api-integration-core-dto/inter-module';
import {
  evaluateConnectionAccess,
  evaluateResourceAccess,
  isConnectionNarrowed,
  type ProjectAccessPolicy,
  REPOSITORY_RESOURCE_KIND,
} from '@shipfox/api-projects-dto';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {RepositoryAuthorizerConfigurationError} from './errors.js';

// Keep every outage retryable while bounding the Sentry volume process-wide.
const REPOSITORY_AUTHORIZATION_REPORT_INTERVAL_MS = 60_000;
let lastRepositoryAuthorizationReportAt = Number.NEGATIVE_INFINITY;

/** Whether the project's access narrows what the connection reaches. */
export type RepositoryAuthorizationAccess = 'all' | 'selected';
export type RepositoryAuthorizationCapability = 'checkout' | 'tools';

export interface RepositoryAuthorizationExternalIdTarget {
  kind: 'external-id';
  externalRepositoryId: string;
}

export interface RepositoryAuthorizationNameTarget {
  kind: 'name';
  owner: string;
  name: string;
}

export type RepositoryAuthorizationTarget =
  | RepositoryAuthorizationExternalIdTarget
  | RepositoryAuthorizationNameTarget;

export type RepositoryAuthorizationDenial =
  | 'repository_required'
  | 'repository_not_granted'
  | 'repository_ambiguous'
  | 'connection_not_allowed'
  | 'project_not_found'
  | 'authorization_store_unavailable';

export const repositoryAuthorizationClientErrorCodes = {
  repository_required: repositoryAuthorizationErrorCodes.required,
  repository_not_granted: repositoryAuthorizationErrorCodes.notGranted,
  repository_ambiguous: repositoryAuthorizationErrorCodes.ambiguous,
  connection_not_allowed: repositoryAuthorizationErrorCodes.connectionNotAllowed,
  project_not_found: repositoryAuthorizationErrorCodes.projectNotFound,
  authorization_store_unavailable: repositoryAuthorizationErrorCodes.storeUnavailable,
} as const satisfies Record<RepositoryAuthorizationDenial, string>;

export type RepositoryAuthorizationClientErrorCode =
  (typeof repositoryAuthorizationClientErrorCodes)[RepositoryAuthorizationDenial];

export function repositoryAuthorizationClientErrorCode(
  reason: RepositoryAuthorizationDenial,
): RepositoryAuthorizationClientErrorCode {
  return repositoryAuthorizationClientErrorCodes[reason];
}

export interface AuthorizedRepository {
  externalRepositoryId?: string | undefined;
  owner?: string | undefined;
  name?: string | undefined;
}

export type RepositoryAuthorizationResult =
  | {
      authorized: true;
      repository: AuthorizedRepository;
      access: RepositoryAuthorizationAccess;
    }
  | {
      authorized: false;
      reason: RepositoryAuthorizationDenial;
      access: RepositoryAuthorizationAccess;
    };

export type ConnectionAuthorizationDenial = Extract<
  RepositoryAuthorizationDenial,
  'connection_not_allowed' | 'project_not_found' | 'authorization_store_unavailable'
>;

export type ConnectionAuthorizationResult =
  | {
      authorized: true;
      /** Whether the project's access limits the connection to some of its repositories. */
      repositoriesNarrowed: boolean;
    }
  | {authorized: false; reason: ConnectionAuthorizationDenial};

type ProjectAccessPolicyLoad =
  | {policy: ProjectAccessPolicy}
  | {denial: 'project_not_found' | 'authorization_store_unavailable'};

export interface RepositoryAuthorizationRequestContext {
  /** One policy load per project, shared by every target one request names. */
  readonly memo: Map<string, Promise<ProjectAccessPolicyLoad>>;
}

export function createRepositoryAuthorizationRequestContext(): RepositoryAuthorizationRequestContext {
  return {memo: new Map()};
}

export interface ResolveConnectionAuthorizationInput {
  workspaceId: string;
  /** The calling project, whose access decides. */
  projectId: string;
  connectionId: string;
  request?: RepositoryAuthorizationRequestContext | undefined;
}

export interface ResolveRepositoryAuthorizationInput extends ResolveConnectionAuthorizationInput {
  repository: RepositoryAuthorizationTarget;
  capability: RepositoryAuthorizationCapability;
}

export interface ResolveRepositoryAuthorizationParams extends ResolveRepositoryAuthorizationInput {
  projects: ProjectsModuleClient;
}

export interface CreateRepositoryAuthorizerOptions {
  projects?: ProjectsModuleClient | undefined;
  /** Every composition must explicitly choose whether authorization is enabled. */
  enabled: boolean;
}

export interface RepositoryAuthorizer {
  readonly enabled: boolean;
  resolveRepositoryAuthorization(
    input: ResolveRepositoryAuthorizationInput,
  ): Promise<RepositoryAuthorizationResult | undefined>;
  resolveConnectionAuthorization(
    input: ResolveConnectionAuthorizationInput,
  ): Promise<ConnectionAuthorizationResult | undefined>;
}

export class RepositoryAuthorizationTargetInvalidError extends Error {
  constructor() {
    super('Repository authorization target is invalid');
    this.name = 'RepositoryAuthorizationTargetInvalidError';
  }
}

/**
 * Decides a repository declaration against the calling project's access. Provider
 * adapters are deliberately not part of the authorization boundary.
 */
export async function resolveRepositoryAuthorization({
  projects,
  workspaceId,
  projectId,
  connectionId,
  repository,
  request,
}: ResolveRepositoryAuthorizationParams): Promise<RepositoryAuthorizationResult> {
  assertValidTarget(repository);

  const loaded = await loadPolicy({projects, workspaceId, projectId, request});
  if ('denial' in loaded) return deny(loaded.denial, 'selected');
  const {policy} = loaded;

  const connection = evaluateConnectionAccess(policy, {connectionId});
  if (!connection.allowed) return deny('connection_not_allowed', 'selected');

  if (!isConnectionNarrowed(policy, {connectionId, resourceKind: REPOSITORY_RESOURCE_KIND})) {
    return authorizeUnnarrowed(repository);
  }

  const decision = evaluateResourceAccess(policy, {
    connectionId,
    target:
      repository.kind === 'external-id'
        ? {
            kind: 'external-id',
            resourceKind: REPOSITORY_RESOURCE_KIND,
            externalId: repository.externalRepositoryId,
          }
        : {
            kind: 'name',
            resourceKind: REPOSITORY_RESOURCE_KIND,
            lookupName: `${repository.owner}/${repository.name}`,
          },
  });
  if (!decision.allowed) {
    return deny(
      decision.reason === 'resource_ambiguous' ? 'repository_ambiguous' : 'repository_not_granted',
      'selected',
    );
  }
  if (decision.resource === null) return authorizeUnnarrowed(repository);

  // The matched id pins a by-name target to the repository access named.
  return {
    authorized: true,
    repository: {externalRepositoryId: decision.resource.externalId},
    access: 'selected',
  };
}

/** Decides whether the calling project can use the connection at all. */
export async function resolveConnectionAuthorization({
  projects,
  workspaceId,
  projectId,
  connectionId,
  request,
}: ResolveConnectionAuthorizationInput & {
  projects: ProjectsModuleClient;
}): Promise<ConnectionAuthorizationResult> {
  const loaded = await loadPolicy({projects, workspaceId, projectId, request});
  if ('denial' in loaded) return {authorized: false, reason: loaded.denial};
  if (!evaluateConnectionAccess(loaded.policy, {connectionId}).allowed) {
    return {authorized: false, reason: 'connection_not_allowed'};
  }
  return {
    authorized: true,
    repositoriesNarrowed: isConnectionNarrowed(loaded.policy, {
      connectionId,
      resourceKind: REPOSITORY_RESOURCE_KIND,
    }),
  };
}

/**
 * Creates the integration-owned authorizer. The required `enabled` option keeps
 * the disabled test seam explicit. A disabled authorizer returns `undefined`,
 * allowing test callers to preserve the pre-enforcement behavior.
 *
 * Nothing is cached across requests: an access change applies on the next call,
 * including the credential renewal of a running job.
 */
export function createRepositoryAuthorizer({
  projects,
  enabled,
}: CreateRepositoryAuthorizerOptions): RepositoryAuthorizer {
  if (!enabled) {
    return {
      enabled: false,
      resolveRepositoryAuthorization() {
        return Promise.resolve(undefined);
      },
      resolveConnectionAuthorization() {
        return Promise.resolve(undefined);
      },
    };
  }
  if (!projects) throw new RepositoryAuthorizerConfigurationError();

  return {
    enabled: true,
    resolveRepositoryAuthorization: (input) => resolveRepositoryAuthorization({projects, ...input}),
    resolveConnectionAuthorization: (input) => resolveConnectionAuthorization({projects, ...input}),
  };
}

async function loadPolicy({
  projects,
  workspaceId,
  projectId,
  request,
}: {
  projects: ProjectsModuleClient;
  workspaceId: string;
  projectId: string;
  request: RepositoryAuthorizationRequestContext | undefined;
}): Promise<ProjectAccessPolicyLoad> {
  const load = () => loadPolicyOnce({projects, workspaceId, projectId});
  if (!request) return await load();

  const key = JSON.stringify([workspaceId, projectId]);
  const cached = request.memo.get(key);
  if (cached) return await cached;

  const pending = load();
  request.memo.set(key, pending);
  try {
    const result = await pending;
    // An outage must stay retryable inside the same request.
    if ('denial' in result && result.denial === 'authorization_store_unavailable') {
      if (request.memo.get(key) === pending) request.memo.delete(key);
    }
    return result;
  } catch (error) {
    if (request.memo.get(key) === pending) request.memo.delete(key);
    throw error;
  }
}

async function loadPolicyOnce({
  projects,
  workspaceId,
  projectId,
}: {
  projects: ProjectsModuleClient;
  workspaceId: string;
  projectId: string;
}): Promise<ProjectAccessPolicyLoad> {
  try {
    const {policy} = await projects.getProjectAccessPolicy({workspaceId, projectId});
    return {policy};
  } catch (error) {
    // A missing project is final: retrying cannot bring it back.
    if (
      isInterModuleKnownError(projectsInterModuleContract.methods.getProjectAccessPolicy, error)
    ) {
      if (error.code === 'project-not-found') return {denial: 'project_not_found'};
    }
    return {denial: storeUnavailable(error)};
  }
}

function storeUnavailable(error: unknown): 'authorization_store_unavailable' {
  if (isCancellationError(error)) throw error;
  logger().error({err: error}, 'Repository authorization lookup failed');
  const now = Date.now();
  if (now - lastRepositoryAuthorizationReportAt >= REPOSITORY_AUTHORIZATION_REPORT_INTERVAL_MS) {
    const eventId = reportError(error, {
      boundary: 'integration.repository-authorization',
      operation: 'load-project-access',
    });
    if (eventId) lastRepositoryAuthorizationReportAt = now;
  }
  return 'authorization_store_unavailable';
}

function isCancellationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      error.name === 'CanceledError' ||
      error.name === 'CancelledError')
  );
}

function authorizeUnnarrowed(
  repository: RepositoryAuthorizationTarget,
): RepositoryAuthorizationResult {
  if (repository.kind === 'external-id') {
    return {
      authorized: true,
      repository: {externalRepositoryId: repository.externalRepositoryId},
      access: 'all',
    };
  }
  return {
    authorized: true,
    repository: {owner: repository.owner, name: repository.name},
    access: 'all',
  };
}

function deny(
  reason: RepositoryAuthorizationDenial,
  access: RepositoryAuthorizationAccess,
): RepositoryAuthorizationResult {
  return {authorized: false, reason, access};
}

function assertValidTarget(repository: RepositoryAuthorizationTarget): void {
  if (!repository || typeof repository !== 'object') {
    throw new RepositoryAuthorizationTargetInvalidError();
  }

  if (repository.kind === 'external-id') {
    if (typeof repository.externalRepositoryId !== 'string') {
      throw new RepositoryAuthorizationTargetInvalidError();
    }
    const separatorIndex = repository.externalRepositoryId.indexOf(':');
    const namespace = repository.externalRepositoryId.slice(0, separatorIndex);
    const value = repository.externalRepositoryId.slice(separatorIndex + 1);
    if (
      separatorIndex <= 0 ||
      !isSafeRepositoryPart(namespace) ||
      !isSafeExternalRepositoryValue(value)
    ) {
      throw new RepositoryAuthorizationTargetInvalidError();
    }
    return;
  }

  if (
    repository.kind !== 'name' ||
    !isSafeRepositoryPart(repository.owner) ||
    !isSafeRepositoryPart(repository.name)
  ) {
    throw new RepositoryAuthorizationTargetInvalidError();
  }
}
