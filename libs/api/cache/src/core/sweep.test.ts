import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {
  archiveOf,
  archiveOfSize,
  cacheClient,
  createCacheTestApp,
  type Reservation,
  saveEntry,
  startJob,
  type TestApp,
  type TestJob,
  uploadParts,
} from '#test/fixtures/cache-api.js';
import {fakeStoragePolicy} from '#test/fixtures/storage-policy.js';
import {
  findEntryRowById,
  insertDeletion,
  listDeletionReasons,
  setCreatedAt,
  setLastAccessedAt,
  setRetentionDays,
} from '#test/queries.js';
import {createWorkspaceStorageLimits} from './storage-policy.js';
import {runCacheSweep} from './sweep.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

function storedObject(job: TestJob, entryId: string) {
  return objectStore().head(
    entryObjectKey({id: entryId, workspaceId: job.workspaceId, projectId: job.projectId}),
  );
}

describe('runCacheSweep', () => {
  let testApp: TestApp;
  const policy = fakeStoragePolicy();

  function sweep(overrides: {now?: () => number} = {}) {
    return runCacheSweep({
      // A fresh resolver per pass, so a limit set by a test is never hidden by the 60 s cache.
      limits: createWorkspaceStorageLimits(policy),
      batchLimit: 2,
      timeBudgetMs: 60_000,
      ...overrides,
    });
  }

  async function reserveAndUpload(job: TestJob, key: string) {
    const body = archiveOf(`upload of ${key}`);
    const reservation = (await cacheClient(testApp.app, job).reserve({key, body})).json();
    const parts = await uploadParts(reservation as Reservation, body);
    const entryId = (reservation as Reservation).entry_id;
    const uploadId = (await findEntryRowById(entryId))?.uploadId;
    if (!uploadId) throw new Error(`Entry ${entryId} has no multipart upload`);
    return {
      entryId,
      parts,
      upload: {
        key: entryObjectKey({id: entryId, workspaceId: job.workspaceId, projectId: job.projectId}),
        uploadId,
        parts,
      },
    };
  }

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('retention', () => {
    it('removes an entry idle past the default retention, with its object', async () => {
      const job = await startJob();
      const idleId = await saveEntry(testApp.app, job, {key: 'idle', body: archiveOf('idle')});
      const usedId = await saveEntry(testApp.app, job, {key: 'used', body: archiveOf('used')});
      await setLastAccessedAt({id: idleId, at: ago(8 * DAY_MS)});
      await setLastAccessedAt({id: usedId, at: ago(6 * DAY_MS)});

      const result = await sweep();

      expect(await findEntryRowById(idleId)).toBeUndefined();
      expect(await storedObject(job, idleId)).toBeNull();
      expect(await findEntryRowById(usedId)).toBeDefined();
      expect(await listDeletionReasons(job.projectId)).toEqual(['expired']);
      expect(result.expired).toBe(1);
    });

    it("applies the workspace's own retention", async () => {
      const short = await startJob();
      const standard = await startJob();
      await setRetentionDays({workspaceId: short.workspaceId, retentionDays: 1});
      const shortId = await saveEntry(testApp.app, short, {key: 'k', body: archiveOf('short')});
      const standardId = await saveEntry(testApp.app, standard, {key: 'k', body: archiveOf('std')});
      await setLastAccessedAt({id: shortId, at: ago(2 * DAY_MS)});
      await setLastAccessedAt({id: standardId, at: ago(2 * DAY_MS)});

      await sweep();

      expect(await findEntryRowById(shortId)).toBeUndefined();
      expect(await findEntryRowById(standardId)).toBeDefined();
    });

    it('leaves the row for the next pass when storage fails to delete the object', async () => {
      const job = await startJob();
      const entryId = await saveEntry(testApp.app, job, {key: 'idle', body: archiveOf('idle')});
      await setLastAccessedAt({id: entryId, at: ago(8 * DAY_MS)});
      vi.spyOn(objectStore(), 'deleteObject').mockRejectedValueOnce(new Error('storage down'));

      const failedPass = await sweep();
      const rowAfterFailure = await findEntryRowById(entryId);
      const nextPass = await sweep();

      expect(failedPass).toMatchObject({expired: 0, failed: 1});
      expect(rowAfterFailure).toBeDefined();
      expect(nextPass).toMatchObject({expired: 1, failed: 0});
      expect(await findEntryRowById(entryId)).toBeUndefined();
    });

    it('stops on its time budget and reports it', async () => {
      const job = await startJob();
      const entryId = await saveEntry(testApp.app, job, {key: 'idle', body: archiveOf('idle')});
      await setLastAccessedAt({id: entryId, at: ago(8 * DAY_MS)});
      let clock = 0;

      const result = await sweep({
        now: () => {
          clock += 60_000;
          return clock;
        },
      });

      expect(result.timedOut).toBe(true);
      expect(await findEntryRowById(entryId)).toBeDefined();
      await sweep();
    });
  });

  describe('stale uploads', () => {
    it('removes an upload older than two hours and ends its multipart upload', async () => {
      const job = await startJob();
      const stale = await reserveAndUpload(job, 'stale');
      const live = await reserveAndUpload(job, 'live');
      await setCreatedAt({id: stale.entryId, at: ago(3 * HOUR_MS)});
      await setCreatedAt({id: live.entryId, at: ago(1 * HOUR_MS)});

      const result = await sweep();

      expect(await findEntryRowById(stale.entryId)).toBeUndefined();
      expect(await findEntryRowById(live.entryId)).toBeDefined();
      expect(result.reaped).toBe(1);
      expect(await objectStore().completeMultipartUpload(stale.upload)).toEqual({
        status: 'upload-not-found',
      });
    });

    it('removes the object of an upload that completed without its row turning ready', async () => {
      const job = await startJob();
      const {entryId, upload} = await reserveAndUpload(job, 'completed');
      const completion = await objectStore().completeMultipartUpload(upload);
      expect(completion.status).toBe('completed');
      await setCreatedAt({id: entryId, at: ago(3 * HOUR_MS)});

      await sweep();

      expect(await findEntryRowById(entryId)).toBeUndefined();
      expect(await storedObject(job, entryId)).toBeNull();
    });

    it('keeps the row when storage fails to end the upload', async () => {
      const job = await startJob();
      const {entryId} = await reserveAndUpload(job, 'stale');
      await setCreatedAt({id: entryId, at: ago(3 * HOUR_MS)});
      vi.spyOn(objectStore(), 'abortMultipartUpload').mockRejectedValueOnce(
        new Error('storage down'),
      );

      const result = await sweep();

      expect(result).toMatchObject({reaped: 0, failed: 1});
      expect(await findEntryRowById(entryId)).toBeDefined();
      await sweep();
    });
  });

  describe('eviction', () => {
    async function saveThree(job: TestJob) {
      const ids: string[] = [];
      for (const [index, key] of ['oldest', 'middle', 'newest'].entries()) {
        const id = await saveEntry(testApp.app, job, {key, body: archiveOfSize(10)});
        await setLastAccessedAt({id, at: ago((3 - index) * HOUR_MS)});
        ids.push(id);
      }
      return ids as [string, string, string];
    }

    it('evicts the least recently used entries until the workspace fits', async () => {
      const job = await startJob();
      const [oldestId, middleId, newestId] = await saveThree(job);
      policy.limit(job.workspaceId, 15);

      const result = await sweep();

      expect(await findEntryRowById(oldestId)).toBeUndefined();
      expect(await findEntryRowById(middleId)).toBeUndefined();
      expect(await storedObject(job, oldestId)).toBeNull();
      expect(await findEntryRowById(newestId)).toBeDefined();
      expect(await listDeletionReasons(job.projectId)).toEqual(['evicted', 'evicted']);
      expect(result.evicted).toBe(2);
    });

    it('leaves a workspace at its limit alone', async () => {
      const job = await startJob();
      const ids = await saveThree(job);
      policy.limit(job.workspaceId, 30);

      await sweep();

      for (const id of ids) expect(await findEntryRowById(id)).toBeDefined();
    });

    it('skips eviction for a workspace whose policy throws', async () => {
      const job = await startJob();
      const ids = await saveThree(job);
      policy.fail(job.workspaceId);

      const result = await sweep();

      for (const id of ids) expect(await findEntryRowById(id)).toBeDefined();
      expect(result.failed).toBe(0);
    });
  });

  describe('deletion records', () => {
    it('prunes records older than 30 days', async () => {
      const projectId = crypto.randomUUID();
      await insertDeletion({projectId, deletedAt: ago(31 * DAY_MS)});
      await insertDeletion({projectId, deletedAt: ago(29 * DAY_MS)});

      const result = await sweep();

      expect(await listDeletionReasons(projectId)).toHaveLength(1);
      expect(result.deletionRecordsPruned).toBe(1);
    });
  });
});
