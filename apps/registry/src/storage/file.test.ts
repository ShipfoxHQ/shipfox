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

  const put = (body: string, condition: {ifNoneMatch?: '*'; ifMatch?: string} = {}) =>
    registry.storage.put({
      key: 'v1/blobs/sha256/abc',
      body: Buffer.from(body),
      contentType: 'application/octet-stream',
      ...condition,
    });

  it('creates a key once with If-None-Match: *', async () => {
    await put('first', {ifNoneMatch: '*'});

    const second = put('second', {ifNoneMatch: '*'});

    await expect(second).rejects.toBeInstanceOf(StoragePreconditionFailedError);
    const stored = await registry.storage.get('v1/blobs/sha256/abc');
    expect(stored?.body.toString()).toBe('first');
  });

  it('replaces a key only while its etag matches', async () => {
    const {etag} = await put('first');
    await put('second', {ifMatch: etag});

    const stale = put('third', {ifMatch: etag});

    await expect(stale).rejects.toBeInstanceOf(StoragePreconditionFailedError);
    const stored = await registry.storage.get('v1/blobs/sha256/abc');
    expect(stored?.body.toString()).toBe('second');
  });

  it('refuses If-Match on a missing key', async () => {
    const write = put('first', {ifMatch: '"missing"'});

    await expect(write).rejects.toBeInstanceOf(StoragePreconditionFailedError);
  });

  it('lets exactly one of two concurrent If-Match writers win', async () => {
    const {etag} = await put('first');

    const results = await Promise.allSettled([
      put('left', {ifMatch: etag}),
      put('right', {ifMatch: etag}),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('returns the same etag on write and read', async () => {
    const {etag} = await put('content');

    const stored = await registry.storage.get('v1/blobs/sha256/abc');

    expect(stored?.etag).toBe(etag);
  });

  it('returns null for a missing key', async () => {
    const stored = await registry.storage.get('v1/index.json');

    expect(stored).toBeNull();
  });

  it('lists keys under a prefix', async () => {
    await put('blob');
    await registry.storage.put({
      key: '_registry/jti/abc',
      body: Buffer.from(''),
      contentType: 'application/octet-stream',
    });

    const keys = await registry.storage.list('v1/');

    expect(keys).toEqual(['v1/blobs/sha256/abc']);
  });

  it.each([
    '../escape',
    'v1/../../escape',
    '/v1/index.json',
    'v1//index.json',
    '',
  ])('refuses the key %j', async (key) => {
    const read = registry.storage.get(key);

    await expect(read).rejects.toThrow('is not a storage key');
  });
});
