import {RequestError} from 'octokit';
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
  Octokit: class Octokit {},
  RequestError: class RequestError extends Error {},
}));

describe('OctokitGithubApiClient.createInstallationAccessToken', () => {
  beforeEach(() => {
    createInstallationAccessTokenMock.mockReset();
  });

  function githubRequestError(status: number, message = 'GitHub denied the request') {
    return Object.assign(
      new RequestError(message, status, {
        request: {
          method: 'POST',
          url: 'https://api.github.com/app/installations/1/access_tokens',
          headers: {},
        },
        response: {
          url: 'https://api.github.com/app/installations/1/access_tokens',
          status,
          headers: {},
          data: {},
        },
      }),
      {
        status,
        response: {headers: {}},
      },
    );
  }

  it('mints a repository-scoped, read-only installation token by default', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: 'ghs_installationtoken',
        expires_at: '2026-06-10T12:00:00.000Z',
        permissions: {contents: 'read', metadata: 'read'},
      },
    });
    const client = createGithubApiClient();

    const result = await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
    });

    expect(result).toEqual({
      token: 'ghs_installationtoken',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      permissions: {contents: 'read'},
    });
    const request = createInstallationAccessTokenMock.mock.calls[0]?.[0];
    expect(request).toEqual({
      installation_id: 1,
      repository_ids: [42],
      permissions: {contents: 'read', metadata: 'read'},
    });
    expect(request.permissions).not.toHaveProperty('workflows');
  });

  it('mints a repository-scoped write installation token when requested', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {
        token: 'ghs_installationtoken',
        expires_at: '2026-06-10T12:00:00.000Z',
        permissions: {contents: 'write', metadata: 'read'},
      },
    });
    const client = createGithubApiClient();

    const result = await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
      contents: 'write',
    });

    expect(result.permissions).toEqual({contents: 'write'});
    const request = createInstallationAccessTokenMock.mock.calls[0]?.[0];
    expect(request.permissions).toEqual({contents: 'write', metadata: 'read'});
    expect(request.permissions).not.toHaveProperty('workflows');
  });

  it('omits granted permissions when GitHub does not report them', async () => {
    createInstallationAccessTokenMock.mockResolvedValue({
      data: {token: 'ghs_installationtoken', expires_at: '2026-06-10T12:00:00.000Z'},
    });
    const client = createGithubApiClient();

    const result = await client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
      contents: 'write',
    });

    expect(result.permissions).toBeUndefined();
  });

  it.each([403, 422])('maps GitHub %s write token denial to access-denied', async (status) => {
    createInstallationAccessTokenMock.mockRejectedValue(githubRequestError(status));
    const client = createGithubApiClient();

    const result = client.createInstallationAccessToken({
      installationId: 1,
      repositoryId: 42,
      contents: 'write',
    });

    await expect(result).rejects.toMatchObject({
      reason: 'access-denied',
      message: 'GitHub installation does not grant write access to repository contents',
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
