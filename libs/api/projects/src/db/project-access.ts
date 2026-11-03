import {and, asc, eq, inArray, sql} from 'drizzle-orm';
import type {
  StoredAccessResource,
  StoredConnectionScope,
  StoredProjectAccess,
} from '#core/entities/project-access.js';
import {db, type Executor, type Tx} from './db.js';
import {projectsConnectionResources} from './schema/connection-resources.js';
import {projectsConnectionScopes} from './schema/connection-scopes.js';
import {projects} from './schema/projects.js';

export const REPOSITORY_RESOURCE_KIND = 'repository';

/** The stored access of each project. A project with no stored scope reads as all connections. */
export async function loadProjectAccessByIds(
  projectIds: readonly string[],
  options: {executor?: Executor | undefined} = {},
): Promise<Map<string, StoredProjectAccess>> {
  if (projectIds.length === 0) return new Map();
  if (options.executor) return await readProjectAccess(options.executor, projectIds);
  // One snapshot, so a concurrent replacement can't pair old scopes with new resources.
  return await db().transaction((tx) => readProjectAccess(tx, projectIds), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

async function readProjectAccess(
  executor: Executor,
  projectIds: readonly string[],
): Promise<Map<string, StoredProjectAccess>> {
  const result = new Map<string, StoredProjectAccess>();

  const [projectRows, scopeRows, resourceRows] = await Promise.all([
    executor
      .select({id: projects.id, connectionAccess: projects.connectionAccess})
      .from(projects)
      .where(inArray(projects.id, [...projectIds])),
    executor
      .select()
      .from(projectsConnectionScopes)
      .where(inArray(projectsConnectionScopes.projectId, [...projectIds]))
      .orderBy(asc(projectsConnectionScopes.createdAt), asc(projectsConnectionScopes.connectionId)),
    executor
      .select()
      .from(projectsConnectionResources)
      .where(inArray(projectsConnectionResources.projectId, [...projectIds]))
      .orderBy(
        asc(projectsConnectionResources.lookupName),
        asc(projectsConnectionResources.externalResourceId),
      ),
  ]);

  const resourcesByScope = new Map<string, StoredAccessResource[]>();
  for (const row of resourceRows) {
    const key = scopeKey(row.projectId, row.connectionId);
    const resources = resourcesByScope.get(key) ?? [];
    resources.push({
      kind: row.resourceKind,
      externalId: row.externalResourceId,
      lookupName: row.lookupName,
      displayName: row.displayName,
    });
    resourcesByScope.set(key, resources);
  }

  const scopesByProject = new Map<string, StoredConnectionScope[]>();
  for (const row of scopeRows) {
    const scopes = scopesByProject.get(row.projectId) ?? [];
    scopes.push({
      connectionId: row.connectionId,
      resources:
        row.resourceScope === 'all'
          ? 'all'
          : (resourcesByScope.get(scopeKey(row.projectId, row.connectionId)) ?? []),
    });
    scopesByProject.set(row.projectId, scopes);
  }

  for (const project of projectRows) {
    result.set(project.id, {
      connectionAccess: project.connectionAccess,
      scopes:
        project.connectionAccess === 'selected' ? (scopesByProject.get(project.id) ?? []) : [],
    });
  }
  return result;
}

function scopeKey(projectId: string, connectionId: string): string {
  return `${projectId}:${connectionId}`;
}

/** Replaces the whole access of a project. The caller holds the project row lock. */
export async function replaceProjectAccess(params: {
  tx: Tx;
  projectId: string;
  access: StoredProjectAccess;
}): Promise<void> {
  const {tx, projectId, access} = params;
  // The resources go with their scope through the cascading foreign key.
  await tx
    .delete(projectsConnectionScopes)
    .where(eq(projectsConnectionScopes.projectId, projectId));
  await tx
    .update(projects)
    .set({connectionAccess: access.connectionAccess, updatedAt: new Date()})
    .where(eq(projects.id, projectId));
  if (access.connectionAccess === 'all' || access.scopes.length === 0) return;

  await tx.insert(projectsConnectionScopes).values(
    access.scopes.map((scope) => ({
      projectId,
      connectionId: scope.connectionId,
      resourceScope: scope.resources === 'all' ? ('all' as const) : ('selected' as const),
    })),
  );
  const resources = access.scopes.flatMap((scope) =>
    scope.resources === 'all'
      ? []
      : scope.resources.map((resource) => ({
          projectId,
          connectionId: scope.connectionId,
          resourceKind: resource.kind,
          externalResourceId: resource.externalId,
          lookupName: resource.lookupName,
          displayName: resource.displayName,
        })),
  );
  if (resources.length > 0) await tx.insert(projectsConnectionResources).values(resources);
}

/** Removes the connection from every project's access. Returns how many projects listed it. */
export async function deleteConnectionScopes(connectionId: string): Promise<number> {
  const result = await db()
    .delete(projectsConnectionScopes)
    .where(eq(projectsConnectionScopes.connectionId, connectionId));
  return result.rowCount ?? 0;
}

/** Follows a provider rename in the stored names of a resource, in every project. */
export async function renameConnectionResource(params: {
  connectionId: string;
  kind: string;
  externalId: string;
  lookupName: string;
  displayName: string;
}): Promise<number> {
  const result = await db()
    .update(projectsConnectionResources)
    .set({lookupName: params.lookupName, displayName: params.displayName})
    .where(
      and(
        eq(projectsConnectionResources.connectionId, params.connectionId),
        eq(projectsConnectionResources.resourceKind, params.kind),
        eq(projectsConnectionResources.externalResourceId, params.externalId),
        // Skips a write that changes nothing, because webhook deliveries repeat.
        sql`(${projectsConnectionResources.lookupName}, ${projectsConnectionResources.displayName}) is distinct from (${params.lookupName}, ${params.displayName})`,
      ),
    );
  return result.rowCount ?? 0;
}
