import {
  archiveOf,
  cacheClient,
  createCacheTestApp,
  type Reservation,
  startJob,
  type TestApp,
  uploadParts,
} from '#test/fixtures/cache-api.js';
import {findEntryRowById} from '#test/queries.js';

const limits = vi.hoisted(() => ({maxEntryBytes: undefined as number | undefined}));

vi.mock('#config.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#config.js')>();
  // A copy, because the real config is frozen against mutation.
  const config = {...original.config};
  Object.defineProperty(config, 'CACHE_MAX_ENTRY_BYTES', {
    get: () => limits.maxEntryBytes ?? original.config.CACHE_MAX_ENTRY_BYTES,
  });
  return {config};
});

describe('cache commit when the entry maximum is lowered after the reserve', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createCacheTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  afterEach(() => {
    limits.maxEntryBytes = undefined;
  });

  it('reports the entry as too large, not as a size mismatch, and removes it', async () => {
    const job = await startJob();
    const client = cacheClient(testApp.app, job);
    const body = archiveOf('exactly the reserved size');
    const reservation = (await client.reserve({key: 'lowered', body})).json() as Reservation;
    const parts = await uploadParts(reservation, body);
    limits.maxEntryBytes = body.length - 1;

    const res = await client.commit(reservation.entry_id, parts);

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('entry-too-large');
    expect(await findEntryRowById(reservation.entry_id)).toBeUndefined();
  });
});
