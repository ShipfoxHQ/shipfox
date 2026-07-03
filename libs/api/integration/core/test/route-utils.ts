import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {afterEach, beforeEach} from '@shipfox/vitest/vi';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {createIntegrationsModule, type IntegrationProvider} from '#index.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(() =>
    Promise.resolve({
      workspaceId: 'workspace',
      workspace: {
        id: 'workspace',
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
      role: 'admin',
    }),
  ),
}));

const {requireMembership} = await import('@shipfox/api-workspaces');
export const requireMembershipMock = vi.mocked(requireMembership);

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({userId: 'user-1', email: 'user@example.com', memberships: []}),
    );
    return Promise.resolve();
  },
};

export function sourceProvider(overrides: Partial<IntegrationProvider> = {}): IntegrationProvider {
  return {
    provider: 'gitea',
    displayName: 'Gitea',
    adapters: {
      source_control: {
        listRepositories: async () => {
          await Promise.resolve();
          return {
            repositories: [
              {
                externalRepositoryId: 'gitea:gitea-owner/platform',
                owner: 'gitea-owner',
                name: 'platform',
                fullName: 'gitea-owner/platform',
                defaultBranch: 'main',
                visibility: 'private',
                cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
                htmlUrl: 'https://gitea.local/gitea-owner/platform',
              },
            ],
            nextCursor: null,
          };
        },
        resolveRepository: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
        listFiles: async () => {
          await Promise.resolve();
          return {files: [], nextCursor: null};
        },
        fetchFile: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
      },
    },
    ...overrides,
  };
}

export async function createTestApp(providers: IntegrationProvider[]): Promise<FastifyInstance> {
  const integrationsModule = await createIntegrationsModule({providers});
  const app = await createApp({
    auth: [fakeUserAuth],
    routes: integrationsModule.routes ?? [],
    swagger: false,
  });
  await app.ready();
  return app;
}

export function useIntegrationRouteTest() {
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    requireMembershipMock.mockResolvedValue({
      workspaceId,
      workspace: {
        id: workspaceId,
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
      role: 'admin',
    });
  });

  afterEach(async () => {
    await closeApp();
  });

  return {
    get workspaceId() {
      return workspaceId;
    },
  };
}
