import {
  type CacheModuleClient,
  cacheInterModuleContract,
} from '@shipfox/api-cache-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError, isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {createWorkspaceStorageLimits} from '#core/storage-policy.js';
import {
  archiveOf,
  createCacheTestApp,
  saveEntry,
  startJob,
  type TestApp,
} from '#test/fixtures/cache-api.js';
import {findEntryRowById} from '#test/queries.js';
import {createCacheInterModulePresentation} from './inter-module.js';

describe('cache inter-module presentation', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const owned = new Map<string, string>();
  const transport = createInMemoryInterModuleTransport();
  const cache: CacheModuleClient = transport.createClient(cacheInterModuleContract);
  transport.register(
    createCacheInterModulePresentation({
      limits: createWorkspaceStorageLimits({
        resolve: () => Promise.resolve({maxStoredBytes: 500}),
      }),
      projects: {
        requireProjectForWorkspace: ({projectId, workspaceId}) => {
          if (owned.get(projectId) === workspaceId) return Promise.resolve({project: {} as never});
          return Promise.reject(
            createInterModuleKnownError(
              projectsInterModuleContract.methods.requireProjectForWorkspace,
              'project-not-found',
              {projectId},
            ),
          );
        },
      },
    }),
  );
  transport.seal();

  async function startOwnedJob() {
    const job = await startJob();
    owned.set(job.projectId, job.workspaceId);
    return job;
  }

  it('lists entries of a project of the workspace, with a cursor that continues after each', async () => {
    const job = await startOwnedJob();
    await saveEntry(testApp.app, job, {key: 'one', body: archiveOf('1')});
    await saveEntry(testApp.app, job, {key: 'two', body: archiveOf('22')});
    await saveEntry(testApp.app, job, {key: 'three', body: archiveOf('333')});
    const firstPage = await cache.listCacheEntries({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      limit: 1,
    });

    const secondPage = await cache.listCacheEntries({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      limit: 5,
      // Resuming from the cursor of an entry is what a trimmed response does.
      cursor: firstPage.entries[0]?.cursor as string,
    });

    expect(firstPage.entries.map((entry) => entry.key)).toEqual(['three']);
    expect(firstPage.nextCursor).toBe(firstPage.entries[0]?.cursor);
    expect(secondPage.entries.map((entry) => entry.key)).toEqual(['two', 'one']);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('reports a project of another workspace as not found', async () => {
    const job = await startOwnedJob();
    const call = cache.listCacheEntries({
      workspaceId: crypto.randomUUID(),
      projectId: job.projectId,
      limit: 10,
    });

    const error = await call.catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(cacheInterModuleContract.methods.listCacheEntries, error) &&
        error.code,
    ).toBe('project-not-found');
  });

  it('reports a cursor it did not issue', async () => {
    const job = await startOwnedJob();

    const error = await cache
      .listCacheEntries({
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        limit: 10,
        cursor: 'nonsense',
      })
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(cacheInterModuleContract.methods.listCacheEntries, error) &&
        error.code,
    ).toBe('invalid-cursor');
  });

  it('deletes one entry or a whole scope of a project of the workspace', async () => {
    const job = await startOwnedJob();
    const single = await saveEntry(testApp.app, job, {scope: 'a', key: 'k', body: archiveOf('12')});
    const scoped = [
      await saveEntry(testApp.app, job, {scope: 'b', key: 'k1', body: archiveOf('1')}),
      await saveEntry(testApp.app, job, {scope: 'b', key: 'k2', body: archiveOf('123')}),
    ];

    const one = await cache.deleteCacheEntries({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      target: {entryId: single},
    });
    const scope = await cache.deleteCacheEntries({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      target: {scope: 'b'},
    });

    expect(one).toEqual({deletedCount: 1, deletedBytes: 2});
    expect(scope).toEqual({deletedCount: 2, deletedBytes: 4});
    expect(await findEntryRowById(single)).toBeUndefined();
    for (const entryId of scoped) expect(await findEntryRowById(entryId)).toBeUndefined();
  });

  it('refuses to delete in a project of another workspace and reports a missing entry', async () => {
    const job = await startOwnedJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('x')});

    const foreign = await cache
      .deleteCacheEntries({
        workspaceId: crypto.randomUUID(),
        projectId: job.projectId,
        target: {entryId},
      })
      .catch((caught: unknown) => caught);
    const missing = await cache
      .deleteCacheEntries({
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        target: {entryId: crypto.randomUUID()},
      })
      .catch((caught: unknown) => caught);

    const method = cacheInterModuleContract.methods.deleteCacheEntries;
    expect(isInterModuleKnownError(method, foreign) && foreign.code).toBe('project-not-found');
    expect(isInterModuleKnownError(method, missing) && missing.code).toBe('entry-not-found');
    expect(await findEntryRowById(entryId)).toBeDefined();
  });

  it('refuses a delete that names both an entry and a scope', async () => {
    const job = await startOwnedJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('x')});

    const error = await cache
      .deleteCacheEntries({
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        target: {entryId, scope: 'default'} as never,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(await findEntryRowById(entryId)).toBeDefined();
  });

  it('reports the usage of the workspace with its limit', async () => {
    const job = await startOwnedJob();
    await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('1234')});

    const usage = await cache.getCacheUsage({workspaceId: job.workspaceId});

    expect(usage).toMatchObject({
      storedBytes: 4,
      limitBytes: 500,
      projects: [{projectId: job.projectId, storedBytes: 4, entryCount: 1}],
      recentDeletions: [],
    });
  });
});
