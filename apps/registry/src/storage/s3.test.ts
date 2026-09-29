import {S3RegistryStorage} from '#storage/s3.js';

const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

const profile = {
  endpoint: 'https://t3.storage.dev',
  region: 'auto',
  bucket: 'registry-blobs',
  credentials: {accessKeyId: 'test-key', secretAccessKey: 'test-secret'},
  forcePathStyle: false,
};

describe('S3RegistryStorage.presignGet', () => {
  it('signs a URL under the prefix that expires after the requested time', async () => {
    const storage = new S3RegistryStorage({profile, prefix: 'registry'});

    const url = new URL(await storage.presignGet({key: 'blobs/sha256/abc', expiresInSeconds: 300}));

    expect(url.host).toBe('registry-blobs.t3.storage.dev');
    expect(url.pathname).toBe('/registry/blobs/sha256/abc');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(SIGNATURE_PATTERN);
    storage.close();
  });

  it('serves the URL from the content host when one is set', async () => {
    const storage = new S3RegistryStorage({
      profile,
      prefix: 'registry',
      contentUrl: new URL('https://content.registry.example.com'),
    });

    const url = new URL(await storage.presignGet({key: 'blobs/sha256/abc', expiresInSeconds: 60}));

    expect(url.origin).toBe('https://content.registry.example.com');
    expect(url.pathname).toBe('/registry/blobs/sha256/abc');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    storage.close();
  });

  it('refuses a key that leaves the store', async () => {
    const storage = new S3RegistryStorage({profile, prefix: 'registry'});

    await expect(storage.presignGet({key: '../secret', expiresInSeconds: 60})).rejects.toThrow(
      TypeError,
    );
    storage.close();
  });
});
