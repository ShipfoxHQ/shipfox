import {
  archiveOf,
  type CacheClient,
  cacheClient,
  createCacheTestApp,
  saveEntry,
  startJob,
  startSiblingJob,
  type TestApp,
} from '#test/fixtures/cache-api.js';
import {findEntryRow} from '#test/queries.js';

describe('cache for dev runs', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function startDevJob(
    base: {workspaceId: string; projectId: string},
    userId: string | null,
  ) {
    const job = await startJob({workspaceId: base.workspaceId, projectId: base.projectId});
    testApp.origins.set(job.workflowRunId, {origin: 'dev', initiatedByUserId: userId});
    return job;
  }

  it('saves into a sandbox of the user that started the run', async () => {
    const synced = await startJob();
    const devJob = await startDevJob(synced, 'user-1');
    await saveEntry(testApp.app, devJob, {scope: 'main', key: 'deps', body: archiveOf('dev')});

    const sandboxed = await findEntryRow({
      projectId: synced.projectId,
      scope: 'dev/user-1/main',
      key: 'deps',
    });
    const shared = await findEntryRow({projectId: synced.projectId, scope: 'main', key: 'deps'});

    expect(sandboxed?.status).toBe('ready');
    expect(shared).toBeUndefined();
  });

  it('hides a dev save from synced runs and from other users', async () => {
    const synced = await startJob();
    const author = await startDevJob(synced, 'user-1');
    const sameUser = await startDevJob(synced, 'user-1');
    const otherUser = await startDevJob(synced, 'user-2');
    const noUser = await startDevJob(synced, null);
    await saveEntry(testApp.app, author, {key: 'deps', body: archiveOf('dev save')});

    const asSynced = await cacheClient(testApp.app, synced).restore({key: 'deps'});
    const asSameUser = await cacheClient(testApp.app, sameUser).restore({key: 'deps'});
    const asOtherUser = await cacheClient(testApp.app, otherUser).restore({key: 'deps'});
    const asNoUser = await cacheClient(testApp.app, noUser).restore({key: 'deps'});

    expect(asSynced.json()).toEqual({hit: null});
    expect(asOtherUser.json()).toEqual({hit: null});
    expect(asNoUser.json()).toEqual({hit: null});
    expect(asSameUser.json().hit).toMatchObject({key: 'deps', scope: 'default', exact: true});
  });

  it('reads the shared scope when its own sandbox has no match', async () => {
    const synced = await startJob();
    const devJob = await startDevJob(synced, 'user-1');
    await saveEntry(testApp.app, synced, {key: 'deps', body: archiveOf('synced')});

    const res = await cacheClient(testApp.app, devJob).restore({key: 'deps'});

    expect(res.json().hit).toMatchObject({key: 'deps', scope: 'default'});
  });

  it('reads its own sandbox before the shared scope', async () => {
    const synced = await startJob();
    const devJob = await startDevJob(synced, 'user-1');
    await saveEntry(testApp.app, synced, {key: 'deps', body: archiveOf('synced')});
    const sandboxId = await saveEntry(testApp.app, devJob, {
      key: 'deps',
      body: archiveOf('from the sandbox'),
    });

    const res = await cacheClient(testApp.app, devJob).restore({key: 'deps'});

    expect(res.json().hit.entry_id).toBe(sandboxId);
  });

  it('saves a dev run without a user into the shared dev sandbox', async () => {
    const synced = await startJob();
    const first = await startDevJob(synced, null);
    const second = await startDevJob(synced, null);
    await saveEntry(testApp.app, first, {key: 'deps', body: archiveOf('anonymous')});

    const stored = await findEntryRow({
      projectId: synced.projectId,
      scope: 'dev/shared/default',
      key: 'deps',
    });
    const res = await cacheClient(testApp.app, second).restore({key: 'deps'});

    expect(stored?.status).toBe('ready');
    expect(res.json().hit).toMatchObject({key: 'deps'});
  });

  it('checks only the sandbox a dev save would write', async () => {
    const synced = await startJob();
    const devJob = await startDevJob(synced, 'user-1');
    await saveEntry(testApp.app, synced, {key: 'deps', body: archiveOf('synced')});

    const beforeSave = await cacheClient(testApp.app, devJob).check({key: 'deps'});
    await saveEntry(testApp.app, devJob, {key: 'deps', body: archiveOf('sandboxed')});
    const afterSave = await cacheClient(testApp.app, devJob).check({key: 'deps'});

    expect(beforeSave.json()).toEqual({exists: false});
    expect(afterSave.json()).toEqual({exists: true});
  });

  it('applies the sandbox to fallback scopes', async () => {
    const synced = await startJob();
    const devJob = await startDevJob(synced, 'user-1');
    await saveEntry(testApp.app, synced, {scope: 'main', key: 'deps', body: archiveOf('main')});

    const res = await cacheClient(testApp.app, devJob).restore({
      scope: 'pr-1',
      fallback_scopes: ['main'],
      key: 'deps',
    });

    expect(res.json().hit).toMatchObject({scope: 'main'});
  });

  it.each([
    ['restore scope', (c: CacheClient) => c.restore({scope: 'dev/user-2/x', key: 'k'})],
    [
      'restore fallback scope',
      (c: CacheClient) => c.restore({fallback_scopes: ['dev/shared/x'], key: 'k'}),
    ],
    [
      'reserve scope',
      (c: CacheClient) => c.reserve({scope: 'dev/user-2/x', key: 'k', body: archiveOf('x')}),
    ],
    ['check scope', (c: CacheClient) => c.check({scope: 'dev/x', key: 'k'})],
    ['the bare dev scope', (c: CacheClient) => c.check({scope: 'dev', key: 'k'})],
  ])('rejects a body that names a dev scope in the %s', async (_name, call) => {
    const job = await startJob();

    const res = await call(cacheClient(testApp.app, job));

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('reserved-scope');
  });

  it('allows a scope that merely starts with the letters dev', async () => {
    const job = await startJob();
    const sibling = await startSiblingJob(job);
    await saveEntry(testApp.app, job, {scope: 'devtools', key: 'k', body: archiveOf('x')});

    const res = await cacheClient(testApp.app, sibling).restore({scope: 'devtools', key: 'k'});

    expect(res.json().hit).toMatchObject({scope: 'devtools'});
  });

  it('answers 404 when Workflows does not know the run', async () => {
    const job = await startJob();
    testApp.origins.set(job.workflowRunId, null);

    const res = await cacheClient(testApp.app, job).restore({key: 'k'});

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('run-not-found');
  });
});
