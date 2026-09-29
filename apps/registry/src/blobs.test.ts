import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
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

const digestOf = (content: string) =>
  `sha256:${createHash('sha256').update(content).digest('hex')}`;
const gzipOf = (content: string, level?: number) => gzipSync(content, {level});

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
    const body = gzipOf('bundle');

    await createBlobStore(registry.storage).put({digest: digestOf('bundle'), body});

    const hex = digestOf('bundle').slice('sha256:'.length);
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

  it('accepts the same blob again, which is a retried publish', async () => {
    const blobs = createBlobStore(registry.storage);
    const body = gzipOf('bundle');
    await blobs.put({digest: digestOf('bundle'), body});

    const again = blobs.put({digest: digestOf('bundle'), body});

    await expect(again).resolves.toBeUndefined();
  });

  it('accepts another gzip encoding of the stored content and keeps the stored one', async () => {
    const content = 'shipfox '.repeat(500);
    const stored = gzipOf(content, 1);
    const other = gzipOf(content, 9);
    expect(other.equals(stored)).toBe(false);
    const blobs = createBlobStore(registry.storage);
    await blobs.put({digest: digestOf(content), body: stored});

    await blobs.put({digest: digestOf(content), body: other});

    expect((await registry.storage.get(blobKey(digestOf(content))))?.body).toEqual(stored);
  });

  it('refuses to overwrite a key that holds other content', async () => {
    const digest = digestOf('bundle');
    const tampered = gzipOf('tampered');
    await registry.storage.put({
      key: blobKey(digest),
      body: tampered,
      contentType: BLOB_CONTENT_TYPE,
    });

    const write = createBlobStore(registry.storage).put({digest, body: gzipOf('bundle')});

    await expect(write).rejects.toBeInstanceOf(BlobConflictError);
    expect((await registry.storage.get(blobKey(digest)))?.body).toEqual(tampered);
  });

  it.each([
    ['gzip data of other content', gzipOf('bundle')],
    ['bytes that are not gzip', Buffer.from('bundle')],
  ])('refuses %s, before writing', async (_name, body) => {
    const put = vi.spyOn(registry.storage, 'put');

    const write = createBlobStore(registry.storage).put({digest: digestOf('other'), body});

    await expect(write).rejects.toBeInstanceOf(BlobDigestMismatchError);
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['sha256:abc', 'md5:0123', '../etc/passwd'])('refuses the digest %j', async (digest) => {
    const write = createBlobStore(registry.storage).put({digest, body: Buffer.from('x')});

    await expect(write).rejects.toThrow('is not a sha256 digest');
  });
});
