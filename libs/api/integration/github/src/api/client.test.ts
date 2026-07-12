import {GithubIntegrationProviderError} from '#core/errors.js';
import {createGithubApiClient} from './client.js';

const {createInstallationAccessTokenMock} = vi.hoisted(() => ({
  createInstallationAccessTokenMock: vi.fn(),
}));

vi.mock('octokit', () => ({
  App: class App {
    octokit = {
      rest: {apps: {createInstallationAccessToken: createInstallationAccessTokenMock}},
    };
  },
  Octokit: {
    defaults(options: unknown) {
      return {defaults: options};
    },
  },
  RequestError: class RequestError extends Error {},
}));

describe('OctokitGithubApiClient.createInstallationAccessToken', () => {
  beforeEach(() => {
    createInstallationAccessTokenMock.mockReset();
  });

  it('mints a repository-scoped, read-only installation token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const client = createGithubApiClient();

    const result = await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
    });

    expect(result).toEqual({
      token: 'ghs_installationtoken',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
    });
    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      repository_ids: [42],
      permissions: {contents: 'read'},
    });
  });

  it('mints a repository-scoped write installation token when requested', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const client = createGithubApiClient();

    await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
      permissions: {contents: 'write'},
    });

    expect(createInstallationAccessTokenMock).toHaveBeenCalledWith({
      installation_id: 1,
      repository_ids: [42],
      permissions: {contents: 'write'},
    });
  });

  it('rejects a response without a token', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const client = createGithubApiClient();

    const result = client.createInstallationAccessToken({installationId: 1, repositoryId: 42});

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
    await expect(result).rejects.toBeInstanceOf(GithubIntegrationProviderError);
  });

  it('rejects a response with a missing or unparseable expiry', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken'},
    });
    const client = createGithubApiClient();

    const result = client.createInstallationAccessToken({installationId: 1, repositoryId: 42});

    await expect(result).rejects.toMatchObject({
      reason: 'malformed-provider-response',
    });
  });
});
