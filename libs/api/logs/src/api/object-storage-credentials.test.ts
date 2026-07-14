import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';

const servers: Server[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
});

function useAmbientCredentialEnvironment(): void {
  vi.stubEnv('LOG_STORAGE_S3_ACCESS_KEY_ID', undefined);
  vi.stubEnv('LOG_STORAGE_S3_SECRET_ACCESS_KEY', undefined);
  vi.stubEnv('AWS_ACCESS_KEY_ID', undefined);
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', undefined);
  vi.stubEnv('AWS_SESSION_TOKEN', undefined);
  vi.stubEnv('AWS_PROFILE', undefined);
  vi.stubEnv('AWS_WEB_IDENTITY_TOKEN_FILE', undefined);
  vi.stubEnv('AWS_ROLE_ARN', undefined);
  vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', '/dev/null');
  vi.stubEnv('AWS_CONFIG_FILE', '/dev/null');
  vi.stubEnv('AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', undefined);
  vi.stubEnv('AWS_CONTAINER_CREDENTIALS_FULL_URI', undefined);
  vi.stubEnv('AWS_CONTAINER_AUTHORIZATION_TOKEN', undefined);
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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

  it('uses ECS task-role credentials for normal and multipart clients', async () => {
    useAmbientCredentialEnvironment();
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          AccessKeyId: 'ecs-access-key',
          SecretAccessKey: 'ecs-secret-key',
          Token: 'ecs-session-token',
          Expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      );
    });
    const port = await listen(server);
    vi.stubEnv('AWS_CONTAINER_CREDENTIALS_FULL_URI', `http://127.0.0.1:${port}/credentials`);
    vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
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
        accessKeyId: 'ecs-access-key',
        secretAccessKey: 'ecs-secret-key',
        sessionToken: 'ecs-session-token',
      }),
      expect.objectContaining({
        accessKeyId: 'ecs-access-key',
        secretAccessKey: 'ecs-secret-key',
        sessionToken: 'ecs-session-token',
      }),
    ]);
    closeS3Client();
    closeUploadS3Client();
  });

  it('fails without logging credential-provider details when no credentials exist', async () => {
    useAmbientCredentialEnvironment();
    vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.resetModules();
    const {closeS3Client, s3Client} = await import('./object-storage.js');

    const credentials = s3Client().config.credentials();

    await expect(credentials).rejects.toThrow('Object storage credentials are unavailable');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    closeS3Client();
  });
});
