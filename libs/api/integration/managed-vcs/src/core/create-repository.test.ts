import {count, eq} from 'drizzle-orm';
import {
  createManagedRepository,
  deleteManagedRepository,
  ManagedRepositoryProjectConflictError,
} from '#core/create-repository.js';
import {ManagedSeedFileError} from '#core/seed-files.js';
import {ManagedSourceControlProvider} from '#core/source-control.js';
import {db} from '#db/db.js';
import {managedObjects} from '#db/schema/objects.js';
import {managedRepositories} from '#db/schema/repositories.js';
import {managedConnection} from '#test/fixtures/repository.js';

const provider = new ManagedSourceControlProvider();
const WORKFLOW = '.shipfox/workflows/triage.yml';

function readInput(params: {workspaceId: string; externalRepositoryId: string}) {
  return {
    connection: managedConnection(params.workspaceId),
    externalRepositoryId: params.externalRepositoryId,
  };
}

describe('createManagedRepository', () => {
  it('commits the seed files to main', async () => {
    const workspaceId = crypto.randomUUID();

    const {externalRepositoryId} = await createManagedRepository({
      workspaceId,
      projectId: crypto.randomUUID(),
      files: [
        {path: WORKFLOW, content: 'name: Triage\n'},
        {path: '.shipfox/prompts/triage.md', content: 'Triage the issue.\n'},
      ],
    });

    const input = readInput({workspaceId, externalRepositoryId});
    const {commit} = await provider.resolveRef({...input, ref: 'main'});
    const listed = await provider.listFiles({
      ...input,
      ref: commit,
      prefix: '.shipfox/',
      limit: 10,
    });
    expect(listed.files.map((file) => file.path)).toEqual(['.shipfox/prompts/triage.md', WORKFLOW]);
    const file = await provider.fetchFile({...input, ref: 'main', path: WORKFLOW});
    expect(file.content).toBe('name: Triage\n');
  });

  it('points main at the empty tree when there are no seed files', async () => {
    const workspaceId = crypto.randomUUID();

    const {externalRepositoryId} = await createManagedRepository({
      workspaceId,
      projectId: crypto.randomUUID(),
    });

    const input = readInput({workspaceId, externalRepositoryId});
    const {commit} = await provider.resolveRef({...input, ref: 'main'});
    const listed = await provider.listFiles({...input, ref: commit, prefix: '', limit: 10});
    expect(listed.files).toEqual([]);
  });

  it('returns the same repository on a repeat call and ignores the new files', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const first = await createManagedRepository({
      workspaceId,
      projectId,
      files: [{path: WORKFLOW, content: 'name: First\n'}],
    });

    const second = await createManagedRepository({
      workspaceId,
      projectId,
      files: [{path: WORKFLOW, content: 'name: Second\n'}],
    });

    expect(second).toEqual(first);
    const file = await provider.fetchFile({
      ...readInput({workspaceId, externalRepositoryId: first.externalRepositoryId}),
      ref: 'main',
      path: WORKFLOW,
    });
    expect(file.content).toBe('name: First\n');
  });

  it('creates one repository when two calls race for a project', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    const results = await Promise.all([
      createManagedRepository({workspaceId, projectId}),
      createManagedRepository({workspaceId, projectId}),
    ]);

    expect(results[0]).toEqual(results[1]);
    const [row] = await db()
      .select({total: count()})
      .from(managedRepositories)
      .where(eq(managedRepositories.projectId, projectId));
    expect(row?.total).toBe(1);
  });

  it('refuses a project that has a repository in another workspace', async () => {
    const projectId = crypto.randomUUID();
    await createManagedRepository({workspaceId: crypto.randomUUID(), projectId});

    const attempt = createManagedRepository({workspaceId: crypto.randomUUID(), projectId});

    await expect(attempt).rejects.toBeInstanceOf(ManagedRepositoryProjectConflictError);
  });

  it.each([
    ['a path outside .shipfox', 'src/index.ts'],
    ['a parent segment', '.shipfox/../secrets.yml'],
    ['a .git segment', '.shipfox/.git/config'],
    ['a backslash', '.shipfox\\workflows.yml'],
    ['an empty segment', '.shipfox//workflows.yml'],
    ['a control character', '.shipfox/workflows\n.yml'],
  ])('refuses %s without writing anything', async (_, path) => {
    const projectId = crypto.randomUUID();

    const attempt = createManagedRepository({
      workspaceId: crypto.randomUUID(),
      projectId,
      files: [{path, content: 'x'}],
    });

    await expect(attempt).rejects.toMatchObject({
      name: ManagedSeedFileError.name,
      problem: 'path-not-allowed',
    });
    const rows = await db()
      .select({id: managedRepositories.id})
      .from(managedRepositories)
      .where(eq(managedRepositories.projectId, projectId));
    expect(rows).toEqual([]);
  });

  it('refuses a file that shares a path with a directory', async () => {
    const attempt = createManagedRepository({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      files: [
        {path: '.shipfox/workflows', content: 'x'},
        {path: '.shipfox/workflows/triage.yml', content: 'y'},
      ],
    });

    await expect(attempt).rejects.toMatchObject({problem: 'path-not-allowed'});
  });

  it('refuses a duplicate path', async () => {
    const attempt = createManagedRepository({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      files: [
        {path: WORKFLOW, content: 'x'},
        {path: WORKFLOW, content: 'y'},
      ],
    });

    await expect(attempt).rejects.toMatchObject({problem: 'path-not-allowed', path: WORKFLOW});
  });

  it('refuses a file over the size limit', async () => {
    const attempt = createManagedRepository({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      files: [{path: WORKFLOW, content: 'x'.repeat(1_000_001)}],
    });

    await expect(attempt).rejects.toMatchObject({problem: 'file-too-large', path: WORKFLOW});
  });

  it('refuses a seed with too many files', async () => {
    const attempt = createManagedRepository({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      files: Array.from({length: 101}, (_, index) => ({
        path: `.shipfox/workflows/${index}.yml`,
        content: 'x',
      })),
    });

    await expect(attempt).rejects.toMatchObject({problem: 'too-many-files'});
  });
});

describe('deleteManagedRepository', () => {
  it('deletes the repository with its objects', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const {repositoryId} = await createManagedRepository({
      workspaceId,
      projectId,
      files: [{path: WORKFLOW, content: 'name: Triage\n'}],
    });

    const deleted = await deleteManagedRepository({workspaceId, projectId});

    expect(deleted).toBe(true);
    const [row] = await db()
      .select({total: count()})
      .from(managedObjects)
      .where(eq(managedObjects.repositoryId, repositoryId));
    expect(row?.total).toBe(0);
  });

  it("leaves another workspace's repository alone", async () => {
    const projectId = crypto.randomUUID();
    await createManagedRepository({workspaceId: crypto.randomUUID(), projectId});

    const deleted = await deleteManagedRepository({workspaceId: crypto.randomUUID(), projectId});

    expect(deleted).toBe(false);
  });

  it('answers false when the project has no repository', async () => {
    const deleted = await deleteManagedRepository({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
    });

    expect(deleted).toBe(false);
  });
});
