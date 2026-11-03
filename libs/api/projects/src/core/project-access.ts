import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {isManagedRepositoryId} from '@shipfox/api-integration-managed-vcs-dto';
import {
  findProjectAccessViolations,
  PROJECT_ACCESS_CHANGED,
  type ProjectAccessPolicy,
  type ProjectsEventMap,
} from '@shipfox/api-projects-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  loadProjectAccessByIds,
  REPOSITORY_RESOURCE_KIND,
  replaceProjectAccess,
} from '#db/project-access.js';
import {getProjectById} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects} from '#db/schema/projects.js';
import type {Project} from './entities/project.js';
import type {
  StoredAccessResource,
  StoredConnectionScope,
  StoredProjectAccess,
} from './entities/project-access.js';
import {
  ProjectAccessInvalidError,
  ProjectAccessProviderError,
  ProjectNotFoundError,
} from './errors.js';

const RESOLVE_CONCURRENCY = 10;

export function toProjectAccessPolicy(
  project: Project,
  access: StoredProjectAccess,
): ProjectAccessPolicy {
  return {
    projectId: project.id,
    configSource: {
      managed: isManagedRepositoryId(project.sourceExternalRepositoryId),
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      lookupName:
        project.sourceRepositoryOwner && project.sourceRepositoryName
          ? `${project.sourceRepositoryOwner}/${project.sourceRepositoryName}`.toLowerCase()
          : null,
    },
    connections:
      access.connectionAccess === 'all'
        ? 'all'
        : access.scopes.map((scope) => ({
            connectionId: scope.connectionId,
            resources:
              scope.resources === 'all'
                ? ('all' as const)
                : scope.resources.map(({kind, externalId, lookupName}) => ({
                    kind,
                    externalId,
                    lookupName,
                  })),
          })),
  };
}

export interface ProjectAccessView {
  project: Project;
  access: StoredProjectAccess;
  policy: ProjectAccessPolicy;
}

async function loadProjectsForWorkspace(
  workspaceId: string,
  projectIds: readonly string[],
): Promise<Project[]> {
  const loaded = await Promise.all(projectIds.map((projectId) => getProjectById(projectId)));
  return loaded.filter(
    (project): project is Project => project !== undefined && project.workspaceId === workspaceId,
  );
}

/** Throws `ProjectNotFoundError` for a missing project, and for one of another workspace. */
export async function getProjectAccess(params: {
  workspaceId: string;
  projectId: string;
}): Promise<ProjectAccessView> {
  const [view] = await getProjectAccesses({
    workspaceId: params.workspaceId,
    projectIds: [params.projectId],
  });
  if (!view) throw new ProjectNotFoundError(params.projectId);
  return view;
}

/** Missing projects, and projects of another workspace, are absent from the result. */
export async function getProjectAccesses(params: {
  workspaceId: string;
  projectIds: readonly string[];
}): Promise<ProjectAccessView[]> {
  const found = await loadProjectsForWorkspace(params.workspaceId, params.projectIds);
  const accessById = await loadProjectAccessByIds(found.map((project) => project.id));
  return found.map((project) => {
    const access = accessById.get(project.id) ?? {connectionAccess: 'all' as const, scopes: []};
    return {project, access, policy: toProjectAccessPolicy(project, access)};
  });
}

export type ProjectAccessConnectionInput = {
  connectionId: string;
  resources: 'all' | ReadonlyArray<{kind: string; externalId: string}>;
};

export interface SetProjectAccessParams {
  actorId: string;
  correlationId: string;
  workspaceId: string;
  projectId: string;
  /** `all` resets the access to the default. */
  connections: 'all' | readonly ProjectAccessConnectionInput[];
  integrations: IntegrationsModuleClient;
}

/**
 * Replaces the access of a project. Every listed connection must be an active, non-internal
 * connection of the workspace, and every listed resource must be visible to its connection, which
 * is checked with the provider. The write and its audit event share one transaction.
 */
export async function setProjectAccess(params: SetProjectAccessParams): Promise<ProjectAccessView> {
  const {project} = await getProjectAccess(params);
  const access = await buildStoredAccess(project, params);

  return await db().transaction(async (tx) => {
    const [locked] = await tx
      .select({id: projects.id})
      .from(projects)
      .where(eq(projects.id, project.id))
      .for('update');
    if (!locked) throw new ProjectNotFoundError(project.id);

    await replaceProjectAccess({tx, projectId: project.id, access});
    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_ACCESS_CHANGED,
      orderingKey: project.id,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        correlationId: params.correlationId,
        occurredAt: new Date().toISOString(),
        connections:
          access.connectionAccess === 'all'
            ? 'all'
            : access.scopes.map((scope) => ({
                connectionId: scope.connectionId,
                resources:
                  scope.resources === 'all' ? ('all' as const) : {count: scope.resources.length},
              })),
      },
    });

    // Read back, so the answer lists connections and resources in the order a later read does.
    const stored = (await loadProjectAccessByIds([project.id], {executor: tx})).get(project.id);
    if (!stored) throw new ProjectNotFoundError(project.id);
    return {project, access: stored, policy: toProjectAccessPolicy(project, stored)};
  });
}

async function buildStoredAccess(
  project: Project,
  params: SetProjectAccessParams,
): Promise<StoredProjectAccess> {
  if (params.connections === 'all') return {connectionAccess: 'all', scopes: []};

  const requested = params.connections.map((connection) => ({
    connectionId: connection.connectionId,
    resources:
      connection.resources === 'all' ? ('all' as const) : dedupeResources(connection.resources),
  }));
  assertShape(project, requested);

  const scopes: StoredConnectionScope[] = [];
  for (const connection of requested) {
    await assertConnectionUsable(params, connection);
    if (connection.resources === 'all') {
      scopes.push({connectionId: connection.connectionId, resources: 'all'});
      continue;
    }
    const resources = await mapWithConcurrency(connection.resources, (resource) =>
      resolveResource(params, connection.connectionId, resource),
    );
    scopes.push({connectionId: connection.connectionId, resources});
  }
  return {connectionAccess: 'selected', scopes};
}

function dedupeResources(
  resources: ReadonlyArray<{kind: string; externalId: string}>,
): Array<{kind: string; externalId: string}> {
  const seen = new Map<string, {kind: string; externalId: string}>();
  for (const resource of resources) {
    seen.set(`${resource.kind}\u0000${resource.externalId}`, resource);
  }
  return [...seen.values()];
}

// The cheap rules come first, so a refused request costs no provider call.
function assertShape(
  project: Project,
  requested: ReadonlyArray<{
    connectionId: string;
    resources: 'all' | ReadonlyArray<{kind: string; externalId: string}>;
  }>,
): void {
  const placeholder = (resource: {kind: string; externalId: string}) => ({
    ...resource,
    lookupName: resource.externalId,
  });
  const violations = findProjectAccessViolations({
    ...toProjectAccessPolicy(project, {connectionAccess: 'all', scopes: []}),
    connections: requested.map((connection) => ({
      connectionId: connection.connectionId,
      resources: connection.resources === 'all' ? 'all' : connection.resources.map(placeholder),
    })),
  });
  const [violation] = violations;
  if (!violation) return;
  if (violation.code === 'duplicate-connection') {
    throw new ProjectAccessInvalidError(
      'connection-duplicate',
      'A connection is listed twice',
      violation.connectionId,
    );
  }
  if (violation.code === 'empty-resource-scope') {
    throw new ProjectAccessInvalidError(
      'empty-resource-scope',
      'A connection limited to some resources needs at least one',
      violation.connectionId,
    );
  }
  throw new ProjectAccessInvalidError(
    'access-limit-exceeded',
    `Access lists too many ${violation.code === 'too-many-resources' ? 'resources' : 'connections'}`,
  );
}

async function assertConnectionUsable(
  params: SetProjectAccessParams,
  connection: {
    connectionId: string;
    resources: 'all' | ReadonlyArray<{kind: string; externalId: string}>;
  },
): Promise<void> {
  const found = await params.integrations.getScopeConnection({
    workspaceId: params.workspaceId,
    connectionId: connection.connectionId,
  });
  if (!found || found.internal || found.lifecycleStatus !== 'active') {
    throw new ProjectAccessInvalidError(
      'connection-invalid',
      'The connection is not an active connection of this workspace',
      connection.connectionId,
    );
  }
  if (connection.resources === 'all') return;
  const declared = new Set(found.resourceKinds.map(({kind}) => kind));
  for (const resource of connection.resources) {
    // v1 limits repositories only, whatever else a provider declares.
    if (resource.kind !== REPOSITORY_RESOURCE_KIND || !declared.has(resource.kind)) {
      throw new ProjectAccessInvalidError(
        'resource-kind-unsupported',
        `The connection can't be limited by ${resource.kind}`,
        connection.connectionId,
      );
    }
  }
}

async function resolveResource(
  params: SetProjectAccessParams,
  connectionId: string,
  resource: {kind: string; externalId: string},
): Promise<StoredAccessResource> {
  const method = integrationsInterModuleContract.methods.resolveScopeResource;
  try {
    const resolved = await params.integrations.resolveScopeResource({
      workspaceId: params.workspaceId,
      connectionId,
      kind: resource.kind,
      externalId: resource.externalId,
    });
    if (!resolved) {
      throw new ProjectAccessInvalidError(
        'resource-not-found',
        'The connection can not see this resource',
        connectionId,
      );
    }
    return {
      kind: resolved.kind,
      // The provider's id, which a request in another casing or spelling resolves to.
      externalId: resolved.externalId,
      lookupName: resolved.lookupName,
      displayName: resolved.displayName,
    };
  } catch (error) {
    if (!isInterModuleKnownError(method, error)) throw error;
    if (error.code === 'provider-failure') {
      throw new ProjectAccessProviderError(error.details.reason, error.details.retryAfterSeconds);
    }
    if (error.code === 'resource-kind-unsupported') {
      throw new ProjectAccessInvalidError(
        'resource-kind-unsupported',
        `The connection can't be limited by ${resource.kind}`,
        connectionId,
      );
    }
    throw new ProjectAccessInvalidError(
      'connection-invalid',
      'The connection is not an active connection of this workspace',
      connectionId,
    );
  }
}

async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  map: (item: Input) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = [];
  for (let index = 0; index < items.length; index += RESOLVE_CONCURRENCY) {
    const batch = items.slice(index, index + RESOLVE_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(map))));
  }
  return results;
}
