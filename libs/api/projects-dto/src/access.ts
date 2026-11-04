import {z} from 'zod';

/** A project lists at most this many connections in its access. */
export const MAX_PROJECT_ACCESS_CONNECTIONS = 100;
/** A project lists at most this many resources across its connections. */
export const MAX_PROJECT_ACCESS_RESOURCES = 1000;
export const REPOSITORY_RESOURCE_KIND = 'repository';

const nonEmptyStringSchema = z.string().min(1);

export const projectAccessResourceSchema = z.object({
  kind: nonEmptyStringSchema,
  externalId: nonEmptyStringSchema,
  lookupName: nonEmptyStringSchema,
});
export type ProjectAccessResource = z.infer<typeof projectAccessResourceSchema>;

export const projectConnectionScopeSchema = z.object({
  connectionId: z.string().uuid(),
  resources: z.union([z.literal('all'), z.array(projectAccessResourceSchema)]),
});
export type ProjectConnectionScope = z.infer<typeof projectConnectionScopeSchema>;

/**
 * Everything the evaluator needs about one project. The config source is where the project's
 * `.shipfox/` tree lives. It is part of the access without being stored as a resource.
 */
export const projectAccessPolicySchema = z.object({
  projectId: z.string().uuid(),
  configSource: z.object({
    managed: z.boolean(),
    connectionId: z.string().uuid(),
    externalRepositoryId: nonEmptyStringSchema,
    lookupName: nonEmptyStringSchema.nullable(),
  }),
  connections: z.union([z.literal('all'), z.array(projectConnectionScopeSchema)]),
});
export type ProjectAccessPolicy = z.infer<typeof projectAccessPolicySchema>;

export type ProjectAccessTarget =
  | {kind: 'external-id'; resourceKind: string; externalId: string}
  | {kind: 'name'; resourceKind: string; lookupName: string};

export type ProjectAccessDenialReason =
  | 'connection_not_allowed'
  | 'resource_not_allowed'
  | 'resource_ambiguous';

/**
 * An allowed decision carries the resource it matched when access is narrowed, so callers pin its
 * id. `resource` is null when nothing narrows the call, and the caller keeps its behavior for a
 * project with full access.
 */
export type ProjectAccessDecision =
  | {allowed: true; resource: {externalId: string; lookupName: string | null} | null}
  | {allowed: false; reason: ProjectAccessDenialReason};

const ALLOWED_UNNARROWED: ProjectAccessDecision = {allowed: true, resource: null};

function findScope(
  policy: ProjectAccessPolicy,
  connectionId: string,
): ProjectConnectionScope | undefined {
  if (policy.connections === 'all') return undefined;
  return policy.connections.find((scope) => scope.connectionId === connectionId);
}

function isConfigSourceConnection(policy: ProjectAccessPolicy, connectionId: string): boolean {
  return policy.configSource.connectionId === connectionId;
}

/**
 * Whether the project can use the connection. The config source connection always passes. The
 * managed config connection is internal, so callers never evaluate it.
 */
export function evaluateConnectionAccess(
  policy: ProjectAccessPolicy,
  {connectionId}: {connectionId: string},
): ProjectAccessDecision {
  if (policy.connections === 'all') return ALLOWED_UNNARROWED;
  if (isConfigSourceConnection(policy, connectionId)) return ALLOWED_UNNARROWED;
  if (findScope(policy, connectionId)) return ALLOWED_UNNARROWED;
  return {allowed: false, reason: 'connection_not_allowed'};
}

/**
 * Whether the connection limits the project to some resources of this kind. A listed connection
 * limits a kind it holds resources of, and an empty list limits every kind. The config source
 * connection also limits repositories to its config repository when the project does not list the
 * connection, since the config repository counts as the one resource.
 */
export function isConnectionNarrowed(
  policy: ProjectAccessPolicy,
  {connectionId, resourceKind}: {connectionId: string; resourceKind: string},
): boolean {
  if (policy.connections === 'all') return false;
  const isConfigConnection =
    isConfigSourceConnection(policy, connectionId) && resourceKind === REPOSITORY_RESOURCE_KIND;
  const scope = findScope(policy, connectionId);
  if (!scope) return isConfigConnection;
  if (scope.resources === 'all') return false;
  return (
    isConfigConnection ||
    scope.resources.length === 0 ||
    scope.resources.some((resource) => resource.kind === resourceKind)
  );
}

/**
 * Whether the project can reach the target through the connection. A call with no target passes
 * when the connection passes.
 */
export function evaluateResourceAccess(
  policy: ProjectAccessPolicy,
  {connectionId, target}: {connectionId: string; target?: ProjectAccessTarget | null | undefined},
): ProjectAccessDecision {
  const connection = evaluateConnectionAccess(policy, {connectionId});
  if (!connection.allowed) return connection;
  if (!target) return ALLOWED_UNNARROWED;
  if (!isConnectionNarrowed(policy, {connectionId, resourceKind: target.resourceKind})) {
    return ALLOWED_UNNARROWED;
  }

  const candidates = new Map<string, {externalId: string; lookupName: string | null}>();
  const scope = findScope(policy, connectionId);
  const listed = scope && scope.resources !== 'all' ? scope.resources : [];
  for (const resource of listed) {
    if (resource.kind === target.resourceKind && matchesTarget(resource, target)) {
      candidates.set(resource.externalId, {
        externalId: resource.externalId,
        lookupName: resource.lookupName,
      });
    }
  }
  const {configSource} = policy;
  if (
    isConfigSourceConnection(policy, connectionId) &&
    target.resourceKind === REPOSITORY_RESOURCE_KIND &&
    matchesTarget(
      {externalId: configSource.externalRepositoryId, lookupName: configSource.lookupName},
      target,
    )
  ) {
    candidates.set(configSource.externalRepositoryId, {
      externalId: configSource.externalRepositoryId,
      lookupName: configSource.lookupName,
    });
  }

  const [match, ...others] = candidates.values();
  if (!match) return {allowed: false, reason: 'resource_not_allowed'};
  // After a rename, two stored resources can answer to one name.
  if (others.length > 0) return {allowed: false, reason: 'resource_ambiguous'};
  return {allowed: true, resource: match};
}

function matchesTarget(
  resource: {externalId: string; lookupName: string | null},
  target: ProjectAccessTarget,
): boolean {
  if (target.kind === 'external-id') return resource.externalId === target.externalId;
  return resource.lookupName?.toLowerCase() === target.lookupName.toLowerCase();
}

/**
 * The connections the project lists that are source control. `sourceControlConnectionIds` are the
 * workspace's active source-control connections, which the caller reads from the integrations
 * context because the policy doesn't know providers.
 */
function listedSourceControlScopes(
  policy: ProjectAccessPolicy,
  sourceControlConnectionIds: readonly string[],
): ProjectConnectionScope[] {
  if (policy.connections === 'all') return [];
  const sourceControl = new Set(sourceControlConnectionIds);
  return policy.connections.filter((scope) => sourceControl.has(scope.connectionId));
}

/** The one source-control connection the project lists, or null when it lists none or several. */
export function soleListedConnection(
  policy: ProjectAccessPolicy,
  {sourceControlConnectionIds}: {sourceControlConnectionIds: readonly string[]},
): string | null {
  const [only, ...others] = listedSourceControlScopes(policy, sourceControlConnectionIds);
  return only && others.length === 0 ? only.connectionId : null;
}

/**
 * The repository a job checks out when it sets no `checkout`. A linked project checks out its
 * config repository. A managed project checks out the one repository its access names: one listed
 * source-control connection, limited to exactly one repository. "All repositories" never counts.
 */
export function defaultCheckoutRepository(
  policy: ProjectAccessPolicy,
  {sourceControlConnectionIds}: {sourceControlConnectionIds: readonly string[]},
): {connectionId: string; externalRepositoryId: string; lookupName: string | null} | null {
  const {configSource} = policy;
  if (!configSource.managed) {
    return {
      connectionId: configSource.connectionId,
      externalRepositoryId: configSource.externalRepositoryId,
      lookupName: configSource.lookupName,
    };
  }

  const connectionId = soleListedConnection(policy, {sourceControlConnectionIds});
  if (connectionId === null) return null;
  const scope = findScope(policy, connectionId);
  if (!scope || scope.resources === 'all') return null;
  const repositories = scope.resources.filter(
    (resource) => resource.kind === REPOSITORY_RESOURCE_KIND,
  );
  const [only, ...others] = repositories;
  if (!only || others.length > 0 || repositories.length !== scope.resources.length) return null;
  return {connectionId, externalRepositoryId: only.externalId, lookupName: only.lookupName};
}

/**
 * The connection a job or tool uses when it names none. A linked project uses its config source
 * connection. A managed project uses the one source-control connection it lists, or, with all
 * connections, the workspace's only source-control connection. Otherwise there is none.
 */
export function defaultConnectionId(
  policy: ProjectAccessPolicy,
  {sourceControlConnectionIds}: {sourceControlConnectionIds: readonly string[]},
): string | null {
  if (!policy.configSource.managed) return policy.configSource.connectionId;
  if (policy.connections !== 'all') {
    return soleListedConnection(policy, {sourceControlConnectionIds});
  }
  const [only, ...others] = sourceControlConnectionIds;
  return only !== undefined && others.length === 0 ? only : null;
}

export type ProjectAccessViolation =
  | {code: 'too-many-connections'; limit: number}
  | {code: 'too-many-resources'; limit: number}
  | {code: 'duplicate-connection'; connectionId: string}
  | {code: 'empty-resource-scope'; connectionId: string};

/**
 * Checks the rules a stored policy must follow. A listed connection limited to some resources
 * needs at least one, except the config source connection of a linked project, where the config
 * repository counts as that resource.
 */
export function findProjectAccessViolations(policy: ProjectAccessPolicy): ProjectAccessViolation[] {
  if (policy.connections === 'all') return [];
  const violations: ProjectAccessViolation[] = [];
  if (policy.connections.length > MAX_PROJECT_ACCESS_CONNECTIONS) {
    violations.push({code: 'too-many-connections', limit: MAX_PROJECT_ACCESS_CONNECTIONS});
  }

  const seen = new Set<string>();
  let resourceCount = 0;
  for (const scope of policy.connections) {
    if (seen.has(scope.connectionId)) {
      violations.push({code: 'duplicate-connection', connectionId: scope.connectionId});
    }
    seen.add(scope.connectionId);
    if (scope.resources === 'all') continue;
    resourceCount += scope.resources.length;
    const configRepositoryCounts =
      !policy.configSource.managed && isConfigSourceConnection(policy, scope.connectionId);
    if (scope.resources.length === 0 && !configRepositoryCounts) {
      violations.push({code: 'empty-resource-scope', connectionId: scope.connectionId});
    }
  }
  if (resourceCount > MAX_PROJECT_ACCESS_RESOURCES) {
    violations.push({code: 'too-many-resources', limit: MAX_PROJECT_ACCESS_RESOURCES});
  }
  return violations;
}
