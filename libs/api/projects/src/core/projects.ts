import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {
  PROJECT_CREATED,
  PROJECT_DELETED,
  PROJECT_SOURCE_BOUND,
  PROJECT_UPDATED,
  type ProjectsEventMap,
} from '@shipfox/api-projects-dto';
import {isUniqueViolation} from '@shipfox/node-drizzle';
import {logger} from '@shipfox/node-opentelemetry';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {updateProject} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {liveProject, projects, toProject} from '#db/schema/projects.js';
import {recordProjectCreated} from '#metrics/instance.js';
import type {Project} from './entities/project.js';
import {
  DefaultProjectExistsError,
  DefaultProjectUndeletableError,
  ProjectAlreadyExistsError,
  ProjectNameMismatchError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  ProjectSourceChangedError,
} from './errors.js';

const PROJECTS_WORKSPACE_SLUG_UNIQUE_CONSTRAINT = 'projects_workspace_slug_unique';
const PROJECTS_SOURCE_UNIQUE_CONSTRAINT = 'projects_source_unique';
const PROJECTS_WORKSPACE_DEFAULT_UNIQUE_CONSTRAINT = 'projects_workspace_default_unique';
type ProjectsDb = ReturnType<typeof db>;
type ProjectsTx = Parameters<Parameters<ProjectsDb['transaction']>[0]>[0];

export interface CreateProjectFromSourceParams {
  actorId: string;
  workspaceId: string;
  name: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  slug: string;
  integrations: IntegrationsModuleClient;
}

export async function createProjectFromSource(
  params: CreateProjectFromSourceParams,
): Promise<Project> {
  const source = await params.integrations.resolveSourceRepository({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
  });
  return await insertProject({...params, source});
}

export interface CreateManagedProjectParams {
  actorId: string;
  workspaceId: string;
  name: string;
  slug: string;
  /** The tree of the first commit. Without it, the project starts with no config. */
  files?: ReadonlyArray<{path: string; content: string}> | undefined;
  /** Marks the workspace's default project. A workspace has at most one. */
  isDefault?: boolean | undefined;
  integrations: IntegrationsModuleClient;
}

/**
 * Creates a project whose config lives in a repository Shipfox hosts. The repository comes first,
 * because every project row needs a source. When anything fails afterward, for a slug conflict for
 * example, the new repository is deleted on a best-effort basis. A failed delete is logged and
 * leaves a repository with no project: one commit that nothing reads.
 */
export async function createManagedProject(params: CreateManagedProjectParams): Promise<Project> {
  const projectId = await generateProjectId();
  try {
    const repository = await params.integrations.createManagedRepository({
      workspaceId: params.workspaceId,
      projectId,
      ...(params.files === undefined ? {} : {files: [...params.files]}),
    });
    const source = await params.integrations.resolveSourceRepository({
      workspaceId: params.workspaceId,
      connectionId: repository.connectionId,
      externalRepositoryId: repository.externalRepositoryId,
    });
    return await insertProject({...params, projectId, source});
  } catch (error) {
    await params.integrations
      .deleteManagedRepository({workspaceId: params.workspaceId, projectId})
      .catch((cleanupError: unknown) => {
        logger().error(
          {err: cleanupError, projectId, workspaceId: params.workspaceId},
          'Could not delete the managed repository of a project that was not created',
        );
      });
    throw error;
  }
}

// The table's own default, so a project made with its id in hand sorts like any other.
async function generateProjectId(): Promise<string> {
  const result = await db().execute<{id: string}>(sql`select uuidv7() as id`);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Postgres returned no project id');
  return id;
}

type ResolvedSource = Awaited<ReturnType<IntegrationsModuleClient['resolveSourceRepository']>>;

async function insertProject(params: {
  actorId: string;
  workspaceId: string;
  name: string;
  slug: string;
  projectId?: string | undefined;
  isDefault?: boolean | undefined;
  source: ResolvedSource;
}): Promise<Project> {
  const {source} = params;
  const project = await db().transaction(async (tx) => {
    let projectRow: typeof projects.$inferSelect | undefined;
    for (let attempt = 0; attempt < 2 && !projectRow; attempt += 1) {
      try {
        [projectRow] = await tx
          .insert(projects)
          .values({
            ...(params.projectId === undefined ? {} : {id: params.projectId}),
            workspaceId: params.workspaceId,
            sourceConnectionId: source.connection.id,
            sourceExternalRepositoryId: source.repository.externalRepositoryId,
            sourceRepositoryOwner: source.repository.owner,
            sourceRepositoryName: source.repository.name,
            sourceDefaultBranch: source.repository.defaultBranch,
            name: params.name,
            slug: params.slug,
            isDefault: params.isDefault ?? false,
          })
          .onConflictDoNothing({
            target: [projects.sourceConnectionId, projects.sourceExternalRepositoryId],
            where: liveProject,
          })
          .returning();
      } catch (error) {
        throw mapProjectInsertError(error, params.slug, params.workspaceId);
      }

      if (!projectRow)
        await assertSourceProjectDoesNotExist(
          tx,
          source.connection.id,
          source.repository.externalRepositoryId,
        );
    }

    if (!projectRow) {
      throw new Error('Project insert returned no rows');
    }

    const project = toProject(projectRow);

    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_CREATED,
      orderingKey: project.id,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        slug: project.slug,
        sourceConnectionId: project.sourceConnectionId,
        sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      },
    });
    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_SOURCE_BOUND,
      orderingKey: project.id,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        sourceConnectionId: project.sourceConnectionId,
        provider: source.connection.provider,
        externalRepositoryId: project.sourceExternalRepositoryId,
      },
    });

    return project;
  });
  recordProjectCreated();
  return project;
}

function mapProjectInsertError(error: unknown, slug: string, workspaceId: string): unknown {
  if (isUniqueViolation(error, PROJECTS_WORKSPACE_SLUG_UNIQUE_CONSTRAINT)) {
    return new ProjectSlugConflictError(slug);
  }
  if (isUniqueViolation(error, PROJECTS_WORKSPACE_DEFAULT_UNIQUE_CONSTRAINT)) {
    return new DefaultProjectExistsError(workspaceId);
  }
  return error;
}

async function assertSourceProjectDoesNotExist(
  tx: ProjectsTx,
  sourceConnectionId: string,
  sourceExternalRepositoryId: string,
): Promise<void> {
  const [existing] = await tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.sourceConnectionId, sourceConnectionId),
        eq(projects.sourceExternalRepositoryId, sourceExternalRepositoryId),
        liveProject,
      ),
    )
    .limit(1);
  if (existing) {
    throw new ProjectAlreadyExistsError(
      existing.id,
      sourceConnectionId,
      sourceExternalRepositoryId,
    );
  }
}

export interface UpdateProjectDetailsParams {
  actorId: string;
  projectId: string;
  name?: string | undefined;
  slug?: string | undefined;
}

export function updateProjectDetails(params: UpdateProjectDetailsParams): Promise<Project> {
  return db().transaction(async (tx) => {
    const update = await updateProject(
      {projectId: params.projectId, name: params.name, slug: params.slug},
      {tx},
    );
    if (!update) throw new ProjectNotFoundError(params.projectId);
    if (!update.changed) return update.project;

    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_UPDATED,
      orderingKey: update.project.id,
      payload: {
        actorId: params.actorId,
        workspaceId: update.project.workspaceId,
        projectId: update.project.id,
        name: update.project.name,
        slug: update.project.slug,
      },
    });

    return update.project;
  });
}

export interface MoveProjectSourceParams {
  actorId: string;
  workspaceId: string;
  projectId: string;
  from: {connectionId: string; externalRepositoryId: string};
  to: {
    connectionId: string;
    provider: string;
    externalRepositoryId: string;
    owner: string;
    name: string;
    defaultBranch: string;
  };
}

/**
 * Moves the config source of a project from `from` to `to`, and announces it as a source bind. A
 * repeat call that finds `to` already set changes nothing and succeeds, so a retried move can't
 * bind twice. Another project that already owns `to` makes this throw `ProjectAlreadyExistsError`.
 */
export async function moveProjectSource(
  params: MoveProjectSourceParams,
): Promise<{moved: boolean}> {
  const {from, to} = params;
  return await db().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, params.projectId), liveProject))
      .for('update');
    if (!current || current.workspaceId !== params.workspaceId) {
      throw new ProjectNotFoundError(params.projectId);
    }
    if (
      current.sourceConnectionId === to.connectionId &&
      current.sourceExternalRepositoryId === to.externalRepositoryId
    ) {
      return {moved: false};
    }
    if (
      current.sourceConnectionId !== from.connectionId ||
      current.sourceExternalRepositoryId !== from.externalRepositoryId
    ) {
      throw new ProjectSourceChangedError(params.projectId);
    }

    try {
      // A savepoint, so the lookup below still runs after the unique violation.
      await tx.transaction(async (savepoint) => {
        await savepoint
          .update(projects)
          .set({
            sourceConnectionId: to.connectionId,
            sourceExternalRepositoryId: to.externalRepositoryId,
            sourceRepositoryOwner: to.owner,
            sourceRepositoryName: to.name,
            sourceDefaultBranch: to.defaultBranch,
            updatedAt: new Date(),
          })
          .where(and(eq(projects.id, params.projectId), liveProject));
      });
    } catch (error) {
      if (isUniqueViolation(error, PROJECTS_SOURCE_UNIQUE_CONSTRAINT)) {
        await assertSourceProjectDoesNotExist(tx, to.connectionId, to.externalRepositoryId);
      }
      throw error;
    }

    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_SOURCE_BOUND,
      orderingKey: params.projectId,
      payload: {
        actorId: params.actorId,
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        sourceConnectionId: to.connectionId,
        provider: to.provider,
        externalRepositoryId: to.externalRepositoryId,
      },
    });
    return {moved: true};
  });
}

export interface DeleteProjectParams {
  actorId: string;
  workspaceId: string;
  projectId: string;
  /** The name the admin typed. It must equal the project's current name. */
  name: string;
}

/**
 * Tombstones a project. From the commit on, every read treats it as missing, and its slug and
 * config repository can be reused. `PROJECT_DELETED` is written in the same transaction, and each
 * module cleans up after it.
 */
export async function deleteProject(params: DeleteProjectParams): Promise<void> {
  await db().transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, params.projectId), liveProject))
      .for('update');
    if (!project || project.workspaceId !== params.workspaceId) {
      throw new ProjectNotFoundError(params.projectId);
    }
    if (project.isDefault) throw new DefaultProjectUndeletableError(project.id);
    if (project.name !== params.name) throw new ProjectNameMismatchError(project.id);

    const deletedAt = new Date();
    await tx
      .update(projects)
      .set({deletedAt, deletedBy: params.actorId, updatedAt: deletedAt})
      .where(eq(projects.id, project.id));
    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_DELETED,
      orderingKey: project.id,
      payload: {
        workspaceId: project.workspaceId,
        projectId: project.id,
        deletedBy: params.actorId,
        deletedAt: deletedAt.toISOString(),
      },
    });
  });
}
