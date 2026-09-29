import {StoragePreconditionFailedError} from '#storage/storage.js';
import {createTemporaryRegistry} from '#test/fixtures/registry.js';

describe('FileRegistryStorage', () => {
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
  });

  afterEach(async () => {
    await registry.cleanup();
  });

  const put = (body: string, condition: {ifNoneMatch?: '*'} = {}) =>
    registry.storage.put({
      key: 'blobs/sha256/abc',
      body: Buffer.from(body),
      contentType: 'application/octet-stream',
      ...condition,
    });

  it('creates a key once with If-None-Match: *', async () => {
    await put('first', {ifNoneMatch: '*'});

    const second = put('second', {ifNoneMatch: '*'});

    await expect(second).rejects.toBeInstanceOf(StoragePreconditionFailedError);
    const stored = await registry.storage.get('blobs/sha256/abc');
    expect(stored?.body.toString()).toBe('first');
  });

  it('lets exactly one of two concurrent create-only writers win', async () => {
    const results = await Promise.allSettled([
      put('left', {ifNoneMatch: '*'}),
      put('right', {ifNoneMatch: '*'}),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('returns the same etag on write and read', async () => {
    const {etag} = await put('content');

    const stored = await registry.storage.get('blobs/sha256/abc');

    expect(stored?.etag).toBe(etag);
  });

  it('returns null for a missing key', async () => {
    const stored = await registry.storage.get('blobs/sha256/missing');

    expect(stored).toBeNull();
  });

  it.each([
    '../escape',
    'blobs/../../escape',
    '/blobs/sha256/abc',
    'blobs//abc',
    '',
  ])('refuses the key %j', async (key) => {
    const read = registry.storage.get(key);

    await expect(read).rejects.toThrow('is not a storage key');
  });
});
