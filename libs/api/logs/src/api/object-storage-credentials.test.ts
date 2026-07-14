afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function useAmbientCredentials(): void {
  vi.stubEnv('LOG_STORAGE_S3_ACCESS_KEY_ID', undefined);
  vi.stubEnv('LOG_STORAGE_S3_SECRET_ACCESS_KEY', undefined);
  vi.stubEnv('AWS_PROFILE', undefined);
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'ambient-access-key');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'ambient-secret-key');
  vi.stubEnv('AWS_SESSION_TOKEN', 'ambient-session-token');
}

describe('S3 client credentials', () => {
  it('uses one explicit credential pair for normal and multipart clients', async () => {
    vi.stubEnv('LOG_STORAGE_S3_ACCESS_KEY_ID', 'explicit-access-key');
    vi.stubEnv('LOG_STORAGE_S3_SECRET_ACCESS_KEY', 'explicit-secret-key');
    vi.resetModules();
    const {closeS3Client, closeUploadS3Client, s3Client, uploadS3Client} = await import(
      './object-storage.js'
    );

    const credentials = await Promise.all([
      s3Client().config.credentials(),
      uploadS3Client().config.credentials(),
    ]);

    expect(credentials).toEqual([
      expect.objectContaining({
        accessKeyId: 'explicit-access-key',
        secretAccessKey: 'explicit-secret-key',
      }),
      expect.objectContaining({
        accessKeyId: 'explicit-access-key',
        secretAccessKey: 'explicit-secret-key',
      }),
    ]);
    closeS3Client();
    closeUploadS3Client();
  });

  it('uses ambient AWS credentials for normal and multipart clients', async () => {
    useAmbientCredentials();
    vi.resetModules();
    const {closeS3Client, closeUploadS3Client, s3Client, uploadS3Client} = await import(
      './object-storage.js'
    );

    const credentials = await Promise.all([
      s3Client().config.credentials(),
      uploadS3Client().config.credentials(),
    ]);

    expect(credentials).toEqual([
      expect.objectContaining({
        accessKeyId: 'ambient-access-key',
        secretAccessKey: 'ambient-secret-key',
        sessionToken: 'ambient-session-token',
      }),
      expect.objectContaining({
        accessKeyId: 'ambient-access-key',
        secretAccessKey: 'ambient-secret-key',
        sessionToken: 'ambient-session-token',
      }),
    ]);
    closeS3Client();
    closeUploadS3Client();
  });
});
