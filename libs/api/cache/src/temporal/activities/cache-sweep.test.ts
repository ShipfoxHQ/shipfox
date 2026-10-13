import {MockActivityEnvironment} from '@temporalio/testing';
import {createWorkspaceStorageLimits} from '#core/storage-policy.js';
import {
  archiveOf,
  createCacheTestApp,
  saveEntry,
  startJob,
  type TestApp,
} from '#test/fixtures/cache-api.js';
import {findEntryRowById, setLastAccessedAt} from '#test/queries.js';
import {createCacheSweepActivity} from './cache-sweep.js';

describe('cacheSweepActivity', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('sweeps an expired entry under a real activity context', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'idle', body: archiveOf('idle')});
    // Past the default CACHE_DEFAULT_RETENTION_DAYS (7) the sweep reads from config.
    await setLastAccessedAt({id: entryId, at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)});
    const activity = createCacheSweepActivity({limits: createWorkspaceStorageLimits()});

    const result = (await new MockActivityEnvironment().run(activity)) as Awaited<
      ReturnType<typeof activity>
    >;

    expect(await findEntryRowById(entryId)).toBeUndefined();
    expect(result.timedOut).toBe(false);
  });
});
