import {
  archiveOfSize,
  cacheClient,
  createCacheTestApp,
  saveEntry,
  startJob,
  type TestApp,
} from '#test/fixtures/cache-api.js';
import {fakeStoragePolicy} from '#test/fixtures/storage-policy.js';
import {findEntryRowById, listDeletionReasons, setLastAccessedAt} from '#test/queries.js';

describe('cache saves under a workspace storage limit', () => {
  let testApp: TestApp;
  const policy = fakeStoragePolicy();

  beforeAll(async () => {
    testApp = await createCacheTestApp({storagePolicy: policy});
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('evicts the least recently used entry at commit and keeps the new one', async () => {
    const job = await startJob();
    policy.limit(job.workspaceId, 25);
    const oldId = await saveEntry(testApp.app, job, {key: 'old', body: archiveOfSize(10)});
    const recentId = await saveEntry(testApp.app, job, {key: 'recent', body: archiveOfSize(10)});
    await setLastAccessedAt({id: oldId, at: new Date(Date.now() - 2 * 60 * 60 * 1000)});

    const newId = await saveEntry(testApp.app, job, {key: 'new', body: archiveOfSize(10)});

    expect(await findEntryRowById(oldId)).toBeUndefined();
    expect(await findEntryRowById(recentId)).toBeDefined();
    expect(await findEntryRowById(newId)).toBeDefined();
    expect(await listDeletionReasons(job.projectId)).toEqual(['evicted']);
  });

  it('never evicts the entry just committed, even when it is the least recently used', async () => {
    const job = await startJob();
    policy.limit(job.workspaceId, 15);
    const firstId = await saveEntry(testApp.app, job, {key: 'first', body: archiveOfSize(10)});
    // Ahead of the clock, so the next commit is the least recently used entry of the workspace.
    await setLastAccessedAt({id: firstId, at: new Date(Date.now() + 60 * 60 * 1000)});

    const secondId = await saveEntry(testApp.app, job, {key: 'second', body: archiveOfSize(10)});

    expect(await findEntryRowById(secondId)).toBeDefined();
    expect(await findEntryRowById(firstId)).toBeUndefined();
  });

  it('answers too_large for an entry over the workspace limit', async () => {
    const job = await startJob();
    policy.limit(job.workspaceId, 5);

    const res = await cacheClient(testApp.app, job).reserve({
      key: 'big',
      body: archiveOfSize(10),
    });

    expect(res.json()).toEqual({status: 'too_large'});
  });

  it('saves without a limit when the policy throws', async () => {
    const job = await startJob();
    policy.fail(job.workspaceId);

    const entryId = await saveEntry(testApp.app, job, {key: 'k', body: archiveOfSize(10)});

    expect(await findEntryRowById(entryId)).toBeDefined();
  });
});
