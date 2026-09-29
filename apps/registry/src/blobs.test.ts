import {createHash} from 'node:crypto';
import {
  BLOB_CACHE_CONTROL,
  BLOB_CONTENT_DISPOSITION,
  BLOB_CONTENT_TYPE,
  BlobConflictError,
  BlobDigestMismatchError,
  blobKey,
  createBlobStore,
} from '#blobs.js';
import type {PutObjectParams} from '#storage/storage.js';
import {createTemporaryRegistry} from '#test/fixtures/registry.js';

const digestOf = (body: Buffer) => `sha256:${createHash('sha256').update(body).digest('hex')}`;

describe('createBlobStore', () => {
  let registry: Awaited<ReturnType<typeof createTemporaryRegistry>>;

  beforeEach(async () => {
    registry = await createTemporaryRegistry();
  });

  afterEach(async () => {
    await registry.cleanup();
  });

  it('writes a blob under blobs/sha256/<hex>, create-only, with its download headers', async () => {
    const put = vi.spyOn(registry.storage, 'put');
    const body = Buffer.from('bundle');

    await createBlobStore(registry.storage).put({digest: digestOf(body), body});

    const hex = digestOf(body).slice('sha256:'.length);
    expect(put).toHaveBeenCalledWith({
      key: `blobs/sha256/${hex}`,
      body,
      contentType: BLOB_CONTENT_TYPE,
      contentDisposition: BLOB_CONTENT_DISPOSITION,
      cacheControl: BLOB_CACHE_CONTROL,
      ifNoneMatch: '*',
    } satisfies PutObjectParams);
    expect(BLOB_CONTENT_TYPE).toBe('application/gzip');
    expect(BLOB_CONTENT_DISPOSITION).toBe('attachment');
    expect(BLOB_CACHE_CONTROL).toBe('private, max-age=31536000, immutable');
    expect((await registry.storage.get(`blobs/sha256/${hex}`))?.body).toEqual(body);
  });

  it('accepts the same bytes again, which is a retried publish', async () => {
    const blobs = createBlobStore(registry.storage);
    const body = Buffer.from('bundle');
    await blobs.put({digest: digestOf(body), body});

    const again = blobs.put({digest: digestOf(body), body});

    await expect(again).resolves.toBeUndefined();
  });

  it('refuses to overwrite a key that holds other bytes', async () => {
    const body = Buffer.from('bundle');
    const digest = digestOf(body);
    await registry.storage.put({
      key: blobKey(digest),
      body: Buffer.from('tampered'),
      contentType: BLOB_CONTENT_TYPE,
    });

    const write = createBlobStore(registry.storage).put({digest, body});

    await expect(write).rejects.toBeInstanceOf(BlobConflictError);
    expect((await registry.storage.get(blobKey(digest)))?.body.toString()).toBe('tampered');
  });

  it('refuses bytes that do not match the digest, before writing', async () => {
    const put = vi.spyOn(registry.storage, 'put');

    const write = createBlobStore(registry.storage).put({
      digest: digestOf(Buffer.from('other')),
      body: Buffer.from('bundle'),
    });

    await expect(write).rejects.toBeInstanceOf(BlobDigestMismatchError);
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['sha256:abc', 'md5:0123', '../etc/passwd'])('refuses the digest %j', async (digest) => {
    const write = createBlobStore(registry.storage).put({digest, body: Buffer.from('x')});

    await expect(write).rejects.toThrow('is not a sha256 digest');
  });
});
