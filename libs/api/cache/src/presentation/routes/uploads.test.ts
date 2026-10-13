import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {
  archiveOf,
  cacheClient,
  createCacheTestApp,
  type Reservation,
  saveEntry,
  startJob,
  startSiblingJob,
  type TestApp,
  uploadParts,
} from '#test/fixtures/cache-api.js';
import {findEntryRow, findEntryRowById, listDeletionReasons} from '#test/queries.js';

describe('cache uploads', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('lets one of two concurrent reserves of a key upload', async () => {
    const first = await startJob();
    const second = await startSiblingJob(first);
    const body = archiveOf('same archive');

    const [a, b] = await Promise.all([
      cacheClient(testApp.app, first).reserve({key: 'race', body}),
      cacheClient(testApp.app, second).reserve({key: 'race', body}),
    ]);

    const statuses = [a.json().status, b.json().status].sort();
    expect(statuses).toEqual(['in_progress', 'reserved']);
  });

  it('returns the reservation again, with fresh URLs, to the job execution that holds it', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const body = archiveOf('retry me');

    const first = (await client.reserve({key: 'retry', body})).json() as Reservation;
    const again = (await client.reserve({key: 'retry', body})).json() as Reservation;

    expect(again.status).toBe('reserved');
    expect(again.entry_id).toBe(first.entry_id);
    const parts = await uploadParts(again, body);
    expect((await client.commit(again.entry_id, parts)).statusCode).toBe(200);
  });

  it('answers exists to a reserve that arrives after the commit', async () => {
    const first = await startJob();
    const second = await startSiblingJob(first);
    await saveEntry(testApp.app, first, {key: 'done', body: archiveOf('x')});

    const res = await cacheClient(testApp.app, second).reserve({key: 'done', body: archiveOf('x')});

    expect(res.json()).toEqual({status: 'exists'});
  });

  it('answers in_progress to another job execution while an upload is open', async () => {
    const holder = await startJob();
    const other = await startSiblingJob(holder);
    await cacheClient(testApp.app, holder).reserve({key: 'open', body: archiveOf('x')});

    const res = await cacheClient(testApp.app, other).reserve({key: 'open', body: archiveOf('x')});

    expect(res.json()).toEqual({status: 'in_progress'});
  });

  it('commits idempotently', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const body = archiveOf('commit twice');
    const reservation = (await client.reserve({key: 'twice', body})).json() as Reservation;
    const parts = await uploadParts(reservation, body);

    const first = await client.commit(reservation.entry_id, parts);
    const second = await client.commit(reservation.entry_id, parts);

    expect(first.json()).toEqual({status: 'ready'});
    expect(second.json()).toEqual({status: 'ready'});
  });

  it('does not let another job execution commit or abort an upload', async () => {
    const holder = await startJob();
    const intruder = await startSiblingJob(holder);
    const body = archiveOf('mine');
    const reservation = (
      await cacheClient(testApp.app, holder).reserve({key: 'mine', body})
    ).json() as Reservation;
    const parts = await uploadParts(reservation, body);

    const commit = await cacheClient(testApp.app, intruder).commit(reservation.entry_id, parts);
    const abort = await cacheClient(testApp.app, intruder).abort(reservation.entry_id);

    expect(commit.statusCode).toBe(404);
    expect(commit.json().code).toBe('entry-not-found');
    expect(abort.statusCode).toBe(204);
    expect((await findEntryRowById(reservation.entry_id))?.status).toBe('uploading');
  });

  it('answers 404 to a commit for an entry in another project', async () => {
    const job = await startJob();
    const stranger = await startJob({workspaceId: job.workspaceId});
    const body = archiveOf('x');
    const reservation = (
      await cacheClient(testApp.app, job).reserve({key: 'k', body})
    ).json() as Reservation;

    const res = await cacheClient(testApp.app, stranger).commit(reservation.entry_id, [
      {number: 1, etag: '"x"'},
    ]);

    expect(res.statusCode).toBe(404);
  });

  it('aborts an upload, frees the key, and ignores a second abort', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const body = archiveOf('abandoned');
    const reservation = (await client.reserve({key: 'abort', body})).json() as Reservation;
    const parts = await uploadParts(reservation, body);

    const aborted = await client.abort(reservation.entry_id);
    const repeated = await client.abort(reservation.entry_id);

    expect(aborted.statusCode).toBe(204);
    expect(repeated.statusCode).toBe(204);
    expect(await findEntryRowById(reservation.entry_id)).toBeUndefined();
    const lateCommit = await client.commit(reservation.entry_id, parts);
    expect(lateCommit.statusCode).toBe(404);
    const reserved = await client.reserve({key: 'abort', body});
    expect(reserved.json().status).toBe('reserved');
  });

  it('leaves a ready entry alone when it is aborted', async () => {
    const job = await startJob();
    const entryId = await saveEntry(testApp.app, job, {key: 'keep', body: archiveOf('x')});

    const res = await cacheClient(testApp.app, job).abort(entryId);

    expect(res.statusCode).toBe(204);
    expect((await findEntryRowById(entryId))?.status).toBe('ready');
  });

  it('rejects a commit when the stored object is not the reserved size', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const reserved = (
      await client.reserve({key: 'liar', body: archiveOf('twelve bytes')})
    ).json() as Reservation;
    const parts = await uploadParts(reserved, archiveOf('four'));

    const res = await client.commit(reserved.entry_id, parts);

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('size-mismatch');
    expect(await findEntryRowById(reserved.entry_id)).toBeUndefined();
    const stored = await objectStore().head(
      entryObjectKey({
        id: reserved.entry_id,
        workspaceId: job.workspaceId,
        projectId: job.projectId,
      }),
    );
    expect(stored).toBeNull();
    expect(
      (await client.reserve({key: 'liar', body: archiveOf('twelve bytes')})).json().status,
    ).toBe('reserved');
  });

  it('rejects a commit whose parts storage does not recognize', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const body = archiveOf('payload');
    const reserved = (await client.reserve({key: 'bad-etag', body})).json() as Reservation;
    await uploadParts(reserved, body);

    const res = await client.commit(reserved.entry_id, [{number: 1, etag: '"deadbeef"'}]);

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('invalid-upload');
    expect((await findEntryRowById(reserved.entry_id))?.status).toBe('uploading');
  });

  it('does not record a deletion for an upload that never became ready', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const reserved = (
      await client.reserve({key: 'quiet', body: archiveOf('x')})
    ).json() as Reservation;

    await client.abort(reserved.entry_id);

    expect(await listDeletionReasons(job.projectId)).toEqual([]);
    expect(await findEntryRow({projectId: job.projectId, scope: 'default', key: 'quiet'})).toBe(
      undefined,
    );
  });
});
