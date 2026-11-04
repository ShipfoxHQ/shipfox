import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  createProject,
  findProjectBySourceRepositoryName,
  getProjectById,
  getProjectBySource,
  getWorkspaceProjectCounts,
  listAdminProjects,
  listProjects,
  listProjectsBySourceConnection,
  requireProjectForWorkspace,
  resolveCheckoutTarget,
  updateProject,
} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects} from '#db/schema/projects.js';
import {projectFactory} from '#test/index.js';
import {
  DefaultProjectUndeletableError,
  ProjectNameMismatchError,
  ProjectNotFoundError,
} from './errors.js';
import {deleteProject} from './projects.js';

async function createLinkedProject(workspaceId: string) {
  return await projectFactory.create({workspaceId});
}

async function createDefaultProject(workspaceId: string) {
  const [row] = await db()
    .insert(projects)
    .values({
      workspaceId,
      sourceConnectionId: crypto.randomUUID(),
      sourceExternalRepositoryId: `managed-vcs:${crypto.randomUUID()}`,
      name: 'Default',
      slug: 'default',
      isDefault: true,
    })
    .returning();
  if (!row) throw new Error('Default project insert returned no row');
  return row;
}

describe('deleteProject', () => {
  it('tombstones the project and writes PROJECT_DELETED in the same commit', async () => {
    const workspaceId = crypto.randomUUID();
    const project = await createLinkedProject(workspaceId);

    await deleteProject({
      actorId: 'user-1',
      workspaceId,
      projectId: project.id,
      name: project.name,
    });

    const [row] = await db().select().from(projects).where(eq(projects.id, project.id));
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.deletedBy).toBe('user-1');
    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${project.id}`);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'projects.project.deleted',
        payload: {
          workspaceId,
          projectId: project.id,
          deletedBy: 'user-1',
          deletedAt: row?.deletedAt?.toISOString(),
        },
      }),
    ]);
  });

  it('hides the project from every read, and keeps it in the admin list', async () => {
    const workspaceId = crypto.randomUUID();
    const project = await projectFactory.create({workspaceId});
    const keeper = await projectFactory.create({workspaceId});
    await db()
      .update(projects)
      .set({sourceRepositoryOwner: 'acme', sourceRepositoryName: 'app'})
      .where(eq(projects.id, project.id));

    await deleteProject({
      actorId: 'user-1',
      workspaceId,
      projectId: project.id,
      name: project.name,
    });

    expect(await getProjectById(project.id)).toBeUndefined();
    expect(
      await getProjectBySource({
        workspaceId,
        sourceConnectionId: project.sourceConnectionId,
        sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      }),
    ).toBeUndefined();
    await expect(
      requireProjectForWorkspace({projectId: project.id, workspaceId}),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(
      await findProjectBySourceRepositoryName({
        workspaceId,
        sourceConnectionId: project.sourceConnectionId,
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: 'app',
      }),
    ).toEqual([]);
    expect(
      (
        await listProjectsBySourceConnection({
          workspaceId,
          sourceConnectionId: project.sourceConnectionId,
          limit: 10,
        })
      ).projects,
    ).toEqual([]);
    expect(
      await resolveCheckoutTarget({workspaceId, target: {project: project.id}}),
    ).toBeUndefined();
    expect(await updateProject({projectId: project.id, name: 'Renamed'})).toBeUndefined();
    expect((await listProjects({workspaceId, limit: 10})).projects.map(({id}) => id)).toEqual([
      keeper.id,
    ]);
    expect(await getWorkspaceProjectCounts({workspaceIds: [workspaceId]})).toEqual([
      {workspaceId, count: 1},
    ]);
    const admin = await listAdminProjects({projectId: project.id, limit: 10});
    expect(admin.projects).toEqual([
      expect.objectContaining({id: project.id, deletedAt: expect.any(Date)}),
    ]);
  });

  it('frees the slug and the config repository for a new project', async () => {
    const workspaceId = crypto.randomUUID();
    const project = await createLinkedProject(workspaceId);
    await deleteProject({
      actorId: 'user-1',
      workspaceId,
      projectId: project.id,
      name: project.name,
    });

    const reused = await createProject({
      workspaceId,
      sourceConnectionId: project.sourceConnectionId,
      sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      name: 'Reborn',
      slug: project.slug,
    });

    expect(reused.id).not.toBe(project.id);
    expect(reused.slug).toBe(project.slug);
    expect((await getProjectById(reused.id))?.name).toBe('Reborn');
  });

  it('refuses the default project', async () => {
    const workspaceId = crypto.randomUUID();
    const defaultProject = await createDefaultProject(workspaceId);

    await expect(
      deleteProject({
        actorId: 'user-1',
        workspaceId,
        projectId: defaultProject.id,
        name: defaultProject.name,
      }),
    ).rejects.toBeInstanceOf(DefaultProjectUndeletableError);

    expect(await getProjectById(defaultProject.id)).toBeDefined();
  });

  it('refuses a name that does not match, case included', async () => {
    const workspaceId = crypto.randomUUID();
    const project = await createLinkedProject(workspaceId);

    await expect(
      deleteProject({
        actorId: 'user-1',
        workspaceId,
        projectId: project.id,
        name: project.name.toLowerCase(),
      }),
    ).rejects.toBeInstanceOf(ProjectNameMismatchError);

    expect(await getProjectById(project.id)).toBeDefined();
  });

  it('treats a project of another workspace and a deleted project as missing', async () => {
    const workspaceId = crypto.randomUUID();
    const project = await createLinkedProject(workspaceId);

    await expect(
      deleteProject({
        actorId: 'user-1',
        workspaceId: crypto.randomUUID(),
        projectId: project.id,
        name: project.name,
      }),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);

    await deleteProject({
      actorId: 'user-1',
      workspaceId,
      projectId: project.id,
      name: project.name,
    });
    await expect(
      deleteProject({actorId: 'user-1', workspaceId, projectId: project.id, name: project.name}),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });
});
