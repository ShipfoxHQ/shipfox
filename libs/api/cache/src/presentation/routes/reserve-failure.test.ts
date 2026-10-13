import {objectStore} from '#api/object-storage.js';
import {
  archiveOf,
  cacheClient,
  createCacheTestApp,
  startJob,
  type TestApp,
} from '#test/fixtures/cache-api.js';
import {findEntryRow} from '#test/queries.js';

vi.mock('#db/entries.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#db/entries.js')>()),
  setUploadId: vi.fn().mockRejectedValue(new Error('database unavailable')),
}));

describe('cache reserve when recording the upload id fails', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('aborts the multipart upload and frees the key', async () => {
    const job = await startJob();
    const abort = vi.spyOn(objectStore(), 'abortMultipartUpload');

    const res = await cacheClient(testApp.app, job).reserve({
      key: 'half-started',
      body: archiveOf('x'),
    });

    expect(res.statusCode).toBe(500);
    expect(abort).toHaveBeenCalledTimes(1);
    await expect(abort.mock.results[0]?.value).resolves.toBeUndefined();
    expect(
      await findEntryRow({projectId: job.projectId, scope: 'default', key: 'half-started'}),
    ).toBeUndefined();
  });
});
