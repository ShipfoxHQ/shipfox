import type {ObjectStorageS3Profile} from './config.js';
import {createS3ObjectStore, type S3ObjectStore} from './store.js';

// Runs against the Garage from compose.yml, like the other consumers' integration tests.
const profile: ObjectStorageS3Profile = {
  endpoint: process.env.OBJECT_STORAGE_S3_ENDPOINT ?? 'http://localhost:3900',
  region: 'garage',
  bucket: 'shipfox-test',
  credentials: {
    accessKeyId: 'GK000000000000000000000000',
    secretAccessKey: '0000000000000000000000000000000000000000000000000000000000000000',
  },
  forcePathStyle: true,
};

const MIN_PART_BYTES = 5 * 1024 * 1024;

function testKey(): string {
  return `multipart-test/${crypto.randomUUID()}`;
}

async function uploadPart(
  store: S3ObjectStore,
  params: {
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array<ArrayBuffer>;
  },
): Promise<string> {
  const {url} = await store.presignUploadPart({
    key: params.key,
    uploadId: params.uploadId,
    partNumber: params.partNumber,
    expiresInSeconds: 60,
  });
  const response = await fetch(url, {method: 'PUT', body: params.body});
  expect(response.status).toBe(200);
  const etag = response.headers.get('etag');
  if (!etag) throw new Error('Part upload returned no ETag');
  return etag;
}

describe('S3ObjectStore multipart uploads against Garage', () => {
  let store: S3ObjectStore;

  beforeAll(() => {
    store = createS3ObjectStore({
      profile,
      prefix: 'multipart-test',
      transferRequestTimeoutMs: 60_000,
    });
  });

  afterAll(() => {
    store.close();
  });

  it('assembles parts uploaded through signed URLs and serves ranged reads', async () => {
    const key = testKey();
    const first = new Uint8Array(MIN_PART_BYTES).fill(1);
    const second = new TextEncoder().encode('tail');
    const uploadId = await store.createMultipartUpload({key});

    const firstEtag = await uploadPart(store, {key, uploadId, partNumber: 1, body: first});
    const secondEtag = await uploadPart(store, {key, uploadId, partNumber: 2, body: second});
    const completed = await store.completeMultipartUpload({
      key,
      uploadId,
      parts: [
        {number: 2, etag: secondEtag},
        {number: 1, etag: firstEtag},
      ],
    });

    expect(completed).toEqual({status: 'completed'});
    const head = await store.head(key);
    expect(head?.contentLength).toBe(first.length + second.length);
    const {url} = await store.presignGet(key, 60);
    const ranged = await fetch(url, {headers: {range: `bytes=${first.length}-`}});
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe('tail');
    await store.deleteObject(key);
  });

  it('aborts an upload and treats a second abort as done', async () => {
    const key = testKey();
    const uploadId = await store.createMultipartUpload({key});
    const etag = await uploadPart(store, {key, uploadId, partNumber: 1, body: new Uint8Array(8)});

    await store.abortMultipartUpload({key, uploadId});
    await expect(store.abortMultipartUpload({key, uploadId})).resolves.toBeUndefined();

    await expect(
      store.completeMultipartUpload({key, uploadId, parts: [{number: 1, etag}]}),
    ).resolves.toEqual({status: 'upload-not-found'});
    expect(await store.head(key)).toBeNull();
  });

  it('reports parts the store refuses instead of throwing', async () => {
    const key = testKey();
    const uploadId = await store.createMultipartUpload({key});
    await uploadPart(store, {key, uploadId, partNumber: 1, body: new TextEncoder().encode('part')});

    const result = await store.completeMultipartUpload({
      key,
      uploadId,
      parts: [{number: 1, etag: '"deadbeef"'}],
    });

    expect(result).toMatchObject({status: 'rejected'});
    await store.abortMultipartUpload({key, uploadId});
  });

  it('signs URLs for the public endpoint', async () => {
    const publicStore = createS3ObjectStore({
      profile,
      prefix: 'multipart-test',
      publicEndpoint: profile.endpoint.replace('localhost', '127.0.0.1'),
    });
    const key = testKey();
    const uploadId = await publicStore.createMultipartUpload({key});

    const etag = await uploadPart(publicStore, {
      key,
      uploadId,
      partNumber: 1,
      body: new TextEncoder().encode('only part'),
    });
    expect(
      await publicStore.completeMultipartUpload({key, uploadId, parts: [{number: 1, etag}]}),
    ).toEqual({status: 'completed'});

    const {url} = await publicStore.presignGet(key, 60);
    expect(new URL(url).hostname).toBe('127.0.0.1');
    expect(await (await fetch(url)).text()).toBe('only part');
    await publicStore.deleteObject(key);
    publicStore.close();
  });
});
