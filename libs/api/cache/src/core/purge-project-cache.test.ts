import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {onProjectDeleted} from '#presentation/subscribers/on-project-deleted.js';
import {
  archiveOf,
  cacheClient,
  createCacheTestApp,
  type Reservation,
  saveEntry,
  startJob,
  startSiblingJob,
  type TestApp,
  type TestJob,
} from '#test/fixtures/cache-api.js';
import {findDeletedScope, findEntryRowById, listDeletionReasons} from '#test/queries.js';
import {purgeProjectCache} from './purge-project-cache.js';

function storedObject(job: TestJob, entryId: string) {
  return objectStore().head(
    entryObjectKey({id: entryId, workspaceId: job.workspaceId, projectId: job.projectId}),
  );
}

describe('purgeProjectCache', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('deletes the entries of the project with their objects, and leaves another project alone', async () => {
    const job = await startJob();
    const other = await startJob();
    const readyId = await saveEntry(testApp.app, job, {key: 'ready', body: archiveOf('ready')});
    const otherId = await saveEntry(testApp.app, other, {key: 'other', body: archiveOf('other')});

    const deleted = await purgeProjectCache({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
    });

    expect(deleted).toBe(1);
    expect(await findEntryRowById(readyId)).toBeUndefined();
    expect(await storedObject(job, readyId)).toBeNull();
    expect(await findEntryRowById(otherId)).toBeDefined();
    expect(await storedObject(other, otherId)).not.toBeNull();
  });

  it('deletes an upload in flight, and records no deletion history', async () => {
    const job = await startJob();
    const body = archiveOf('uploading');
    const reservation = (await cacheClient(testApp.app, job).reserve({key: 'k', body})).json();

    await purgeProjectCache({workspaceId: job.workspaceId, projectId: job.projectId});

    expect(await findEntryRowById((reservation as Reservation).entry_id)).toBeUndefined();
    expect(await listDeletionReasons(job.projectId)).toEqual([]);
  });

  it('sets purged_at, and repeating the purge changes nothing', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('k')});
    const scope = {workspaceId: job.workspaceId, projectId: job.projectId};

    await purgeProjectCache(scope);
    const first = await findDeletedScope(job.projectId);
    const repeated = await purgeProjectCache(scope);
    const second = await findDeletedScope(job.projectId);

    expect(first?.purgedAt).toBeInstanceOf(Date);
    expect(repeated).toBe(0);
    expect(second).toEqual(first);
  });

  it('keeps the row when storage fails, and a repeat finishes the job', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('k')});
    const scope = {workspaceId: job.workspaceId, projectId: job.projectId};
    vi.spyOn(objectStore(), 'deleteObject').mockRejectedValueOnce(new Error('storage down'));

    await expect(purgeProjectCache(scope)).rejects.toThrow('storage down');
    const rowAfterFailure = await findEntryRowById(entryId);
    await purgeProjectCache(scope);

    expect(rowAfterFailure).toBeDefined();
    expect(await findEntryRowById(entryId)).toBeUndefined();
    expect((await findDeletedScope(job.projectId))?.purgedAt).toBeInstanceOf(Date);
  });

  it('refuses a reserve after the project was deleted', async () => {
    const job = await startJob();
    await purgeProjectCache({workspaceId: job.workspaceId, projectId: job.projectId});

    const response = await cacheClient(testApp.app, job).reserve({
      key: 'late',
      body: archiveOf('late'),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({code: 'project-not-found'});
  });

  it('still serves a sibling job of another project in the same workspace', async () => {
    const job = await startJob();
    const sibling = await startSiblingJob(job, {projectId: crypto.randomUUID()});
    await purgeProjectCache({workspaceId: job.workspaceId, projectId: job.projectId});

    const response = await cacheClient(testApp.app, sibling).reserve({
      key: 'k',
      body: archiveOf('k'),
    });

    expect(response.statusCode).toBe(200);
  });
});

describe('onProjectDeleted', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('purges the cache of the deleted project', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('k')});

    await onProjectDeleted({
      workspaceId: job.workspaceId,
      projectId: job.projectId,
      deletedBy: 'user',
      deletedAt: new Date().toISOString(),
    });

    expect(await findEntryRowById(entryId)).toBeUndefined();
  });
});
