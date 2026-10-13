import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {
  archiveOf,
  cacheClient,
  createCacheTestApp,
  saveEntry,
  startJob,
  type TestApp,
} from '#test/fixtures/cache-api.js';
import {findEntryRowById, listDeletionReasons, setLastAccessedAt} from '#test/queries.js';

function objectKeyOf(job: {workspaceId: string; projectId: string}, entryId: string): string {
  return entryObjectKey({id: entryId, workspaceId: job.workspaceId, projectId: job.projectId});
}

describe('cache consistency with object storage', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('drops an entry whose object is gone and keeps looking', async () => {
    const job = await startJob();
    const olderId = await saveEntry(testApp.app, job, {key: 'pnpm-1', body: archiveOf('older')});
    const newerId = await saveEntry(testApp.app, job, {key: 'pnpm-2', body: archiveOf('newer')});
    await objectStore().deleteObject(objectKeyOf(job, newerId));

    const res = await cacheClient(testApp.app, job).restore({
      key: 'pnpm-2',
      restore_keys: ['pnpm-'],
    });

    expect(res.json().hit).toMatchObject({entry_id: olderId, key: 'pnpm-1', exact: false});
    expect(await findEntryRowById(newerId)).toBeUndefined();
    expect(await listDeletionReasons(job.projectId)).toEqual(['missing']);
  });

  it('reports a miss, and lets a later save proceed, once the only object is gone', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'lost', body: archiveOf('x')});
    await objectStore().deleteObject(objectKeyOf(job, entryId));

    const restore = await cacheClient(testApp.app, job).restore({key: 'lost'});
    const reserve = await cacheClient(testApp.app, job).reserve({
      key: 'lost',
      body: archiveOf('x'),
    });

    expect(restore.json()).toEqual({hit: null});
    expect(reserve.json().status).toBe('reserved');
  });

  it('drops an entry whose object changed size', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {
      key: 'resized',
      body: archiveOf('original'),
    });
    await objectStore().putBytes({
      key: objectKeyOf(job, entryId),
      body: Buffer.from('replaced with something longer'),
    });

    const res = await cacheClient(testApp.app, job).restore({key: 'resized'});

    expect(res.json()).toEqual({hit: null});
    expect(await findEntryRowById(entryId)).toBeUndefined();
    expect(await objectStore().head(objectKeyOf(job, entryId))).toBeNull();
  });

  it('keeps an entry when the store does not report an object size', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'sizeless', body: archiveOf('x')});
    vi.spyOn(objectStore(), 'head').mockResolvedValue({metadata: {}});

    const restore = await cacheClient(testApp.app, job).restore({key: 'sizeless'});
    const check = await cacheClient(testApp.app, job).check({key: 'sizeless'});

    expect(restore.json().hit).toMatchObject({entry_id: entryId});
    expect(check.json()).toEqual({exists: true});
    expect(await findEntryRowById(entryId)).toBeDefined();
  });

  it('answers check from the object, not only the row', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const entryId = await saveEntry(testApp.app, job, {key: 'checked', body: archiveOf('x')});

    const present = await client.check({key: 'checked'});
    await objectStore().deleteObject(objectKeyOf(job, entryId));
    const missing = await client.check({key: 'checked'});

    expect(present.json()).toEqual({exists: true});
    expect(missing.json()).toEqual({exists: false});
    expect(await findEntryRowById(entryId)).toBeUndefined();
    expect(await listDeletionReasons(job.projectId)).toEqual(['missing']);
  });

  it('answers check false for a key that was never saved or is still uploading', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    await client.reserve({key: 'uploading', body: archiveOf('x')});

    const unknown = await client.check({key: 'nothing'});
    const pending = await client.check({key: 'uploading'});

    expect(unknown.json()).toEqual({exists: false});
    expect(pending.json()).toEqual({exists: false});
  });

  it('refreshes the entry it finds when its last use is over an hour old', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'touched', body: archiveOf('x')});
    await setLastAccessedAt({id: entryId, at: new Date(Date.now() - 3 * 3_600_000)});

    await cacheClient(testApp.app, job).check({key: 'touched'});

    const refreshed = await findEntryRowById(entryId);
    expect(Date.now() - (refreshed?.lastAccessedAt.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it('refreshes the entry a repeated save finds', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'resaved', body: archiveOf('x')});
    await setLastAccessedAt({id: entryId, at: new Date(Date.now() - 3 * 3_600_000)});

    const res = await cacheClient(testApp.app, job).reserve({key: 'resaved', body: archiveOf('x')});

    expect(res.json()).toEqual({status: 'exists'});
    const refreshed = await findEntryRowById(entryId);
    expect(Date.now() - (refreshed?.lastAccessedAt.getTime() ?? 0)).toBeLessThan(60_000);
  });
});
