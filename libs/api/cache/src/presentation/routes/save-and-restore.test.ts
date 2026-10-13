import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {
  archiveOf,
  archiveOfSize,
  cacheClient,
  createCacheTestApp,
  MULTI_PART_BYTES,
  type Reservation,
  saveEntry,
  startJob,
  startSiblingJob,
  type TestApp,
  uploadParts,
} from '#test/fixtures/cache-api.js';
import {findEntryRow, findEntryRowById, setCommittedAt, setLastAccessedAt} from '#test/queries.js';

interface Hit {
  entry_id: string;
  scope: string;
  key: string;
  exact: boolean;
  size_bytes: number;
  sha256: string;
  url: string;
}

describe('cache save and restore', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('rejects a request without a lease token', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/runs/jobs/current/cache/restore',
      payload: {scope: 'default', key: 'k', version: 'v1'},
    });

    expect(res.statusCode).toBe(401);
  });

  it('restores an entry by exact key through the signed URL', async () => {
    const saver = await startJob();
    const restorer = await startSiblingJob(saver);
    const archive = archiveOf('node_modules contents');
    const entryId = await saveEntry(testApp.app, saver, {key: 'pnpm-abc', body: archive});

    const res = await cacheClient(testApp.app, restorer).restore({key: 'pnpm-abc'});

    expect(res.statusCode).toBe(200);
    const hit = (res.json() as {hit: Hit}).hit;
    expect(hit).toMatchObject({
      entry_id: entryId,
      scope: 'default',
      key: 'pnpm-abc',
      exact: true,
      size_bytes: archive.length,
    });
    expect(Buffer.from(await (await fetch(hit.url)).arrayBuffer()).toString()).toBe(
      'node_modules contents',
    );
  });

  it('serves any byte range of the archive from one signed URL', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {key: 'ranges', body: archiveOf('0123456789')});

    const res = await cacheClient(testApp.app, job).restore({key: 'ranges'});
    const {url} = (res.json() as {hit: Hit}).hit;

    const tail = await fetch(url, {headers: {range: 'bytes=7-9'}});
    const head = await fetch(url, {headers: {range: 'bytes=0-2'}});
    expect(await tail.text()).toBe('789');
    expect(await head.text()).toBe('012');
  });

  it('stores an archive larger than one part across several signed part URLs', async () => {
    const job = await startJob();
    const archive = archiveOfSize(MULTI_PART_BYTES);
    const reserved = await cacheClient(testApp.app, job).reserve({key: 'big', body: archive});
    const reservation = reserved.json() as Reservation;
    expect(reservation.part_urls).toHaveLength(2);

    const parts = await uploadParts(reservation, archive);
    const committed = await cacheClient(testApp.app, job).commit(reservation.entry_id, parts);

    expect(committed.json()).toEqual({status: 'ready'});
    const stored = await objectStore().head(
      entryObjectKey({
        id: reservation.entry_id,
        workspaceId: job.workspaceId,
        projectId: job.projectId,
      }),
    );
    expect(stored?.contentLength).toBe(MULTI_PART_BYTES);
  });

  it('prefers the exact key over a restore key that also matches', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {key: 'pnpm-1', body: archiveOf('old')});
    await saveEntry(testApp.app, job, {key: 'pnpm-2', body: archiveOf('exact')});

    const res = await cacheClient(testApp.app, job).restore({
      key: 'pnpm-2',
      restore_keys: ['pnpm-'],
    });

    expect((res.json() as {hit: Hit}).hit).toMatchObject({key: 'pnpm-2', exact: true});
  });

  it('falls back to the newest entry matching a restore key', async () => {
    const job = await startJob();
    const olderId = await saveEntry(testApp.app, job, {key: 'pnpm-1', body: archiveOf('older')});
    const newerId = await saveEntry(testApp.app, job, {key: 'pnpm-2', body: archiveOf('newer')});
    await setCommittedAt({id: olderId, at: new Date(Date.now() - 60_000)});
    await setCommittedAt({id: newerId, at: new Date(Date.now() - 1_000)});

    const res = await cacheClient(testApp.app, job).restore({
      key: 'pnpm-3',
      restore_keys: ['pnpm-'],
    });

    expect((res.json() as {hit: Hit}).hit).toMatchObject({
      entry_id: newerId,
      key: 'pnpm-2',
      exact: false,
    });
  });

  it('tries restore keys in order before moving on', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {key: 'tools-1', body: archiveOf('tools')});
    await saveEntry(testApp.app, job, {key: 'deps-1', body: archiveOf('deps')});

    const res = await cacheClient(testApp.app, job).restore({
      key: 'none',
      restore_keys: ['deps-', 'tools-'],
    });

    expect((res.json() as {hit: Hit}).hit.key).toBe('deps-1');
  });

  it('reads the scopes in order and reports the scope that matched', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {scope: 'main', key: 'k', body: archiveOf('from main')});

    const res = await cacheClient(testApp.app, job).restore({
      scope: 'pr-12',
      fallback_scopes: ['other', 'main'],
      key: 'k',
    });

    expect((res.json() as {hit: Hit}).hit).toMatchObject({scope: 'main', key: 'k'});
  });

  it('treats restore keys as literal prefixes', async () => {
    const job = await startJob();
    await saveEntry(testApp.app, job, {key: 'a_b', body: archiveOf('x')});
    await saveEntry(testApp.app, job, {key: 'a%c', body: archiveOf('y')});

    const underscore = await cacheClient(testApp.app, job).restore({
      key: 'none',
      restore_keys: ['a_'],
    });
    const wildcard = await cacheClient(testApp.app, job).restore({
      key: 'none',
      restore_keys: ['%'],
    });

    expect((underscore.json() as {hit: Hit}).hit.key).toBe('a_b');
    expect((wildcard.json() as {hit: null}).hit).toBeNull();
  });

  it('misses for another version, another scope, and another project', async () => {
    const job = await startJob();
    const otherProject = await startJob({workspaceId: job.workspaceId});
    await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('x')});

    const otherVersion = await cacheClient(testApp.app, job).restore({key: 'k', version: 'zzz'});
    const otherScope = await cacheClient(testApp.app, job).restore({scope: 'elsewhere', key: 'k'});
    const foreign = await cacheClient(testApp.app, otherProject).restore({key: 'k'});

    expect(otherVersion.json()).toEqual({hit: null});
    expect(otherScope.json()).toEqual({hit: null});
    expect(foreign.json()).toEqual({hit: null});
  });

  it('ignores an entry that is still uploading', async () => {
    const job = await startJob();
    await cacheClient(testApp.app, job).reserve({key: 'pending', body: archiveOf('x')});

    const res = await cacheClient(testApp.app, job).restore({key: 'pending'});

    expect(res.json()).toEqual({hit: null});
  });

  it('refreshes the last use of a restored entry only when it is over an hour old', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('x')});
    const recent = new Date(Date.now() - 10 * 60_000);
    await setLastAccessedAt({id: entryId, at: recent});

    await cacheClient(testApp.app, job).restore({key: 'k'});
    const afterRecent = await findEntryRowById(entryId);
    await setLastAccessedAt({id: entryId, at: new Date(Date.now() - 2 * 3_600_000)});
    await cacheClient(testApp.app, job).restore({key: 'k'});
    const afterStale = await findEntryRowById(entryId);

    expect(afterRecent?.lastAccessedAt.getTime()).toBe(recent.getTime());
    expect(Date.now() - (afterStale?.lastAccessedAt.getTime() ?? 0)).toBeLessThan(60_000);
  });

  it('answers a repeated save with exists and keeps the first archive', async () => {
    const job = await startJob();
    const first = await saveEntry(testApp.app, job, {key: 'k', body: archiveOf('first')});

    const second = await cacheClient(testApp.app, job).reserve({
      key: 'k',
      body: archiveOf('second'),
    });

    expect(second.json()).toEqual({status: 'exists'});
    expect((await findEntryRow({projectId: job.projectId, scope: 'default', key: 'k'}))?.id).toBe(
      first,
    );
  });

  it('refuses an archive over the entry maximum', async () => {
    const job = await startJob();

    const res = await cacheClient(testApp.app, job).reserveRaw({
      scope: 'default',
      key: 'huge',
      version: 'v1',
      size_bytes: 10_737_418_241,
      sha256: 'a'.repeat(64),
    });

    expect(res.json()).toEqual({status: 'too_large'});
    expect(await findEntryRow({projectId: job.projectId, scope: 'default', key: 'huge'})).toBe(
      undefined,
    );
  });
});
