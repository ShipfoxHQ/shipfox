import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {createProjectRoutes} from './index.js';

let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        name: 'User One',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

describe('project routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let sourceConnectionId: string;
  let integrations: Pick<IntegrationsModuleClient, 'resolveSourceRepository'>;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin'}];
    integrations = {
      resolveSourceRepository: vi.fn(async () => {
        await Promise.resolve();
        return {
          connection: {
            id: sourceConnectionId,
            provider: 'gitea' as const,
            slug: 'gitea_owner',
          },
          repository: {
            externalRepositoryId: 'gitea:gitea-owner/platform',
            owner: 'gitea-owner',
            name: 'platform',
            fullName: 'gitea-owner/platform',
            defaultBranch: 'main',
            visibility: 'private' as const,
            cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
            htmlUrl: 'https://gitea.local/gitea-owner/platform',
          },
        };
      }),
    };
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createProjectRoutes(integrations as IntegrationsModuleClient),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('creates a project for a source repository', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: '  Platform  ',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Platform');
    expect(res.json().source).toEqual({
      connection_id: sourceConnectionId,
      external_repository_id: 'gitea:gitea-owner/platform',
    });
  });

  test.each([
    ['blank after trimming', '   '],
    ['with control characters', 'Plat\nform'],
    ['with format characters', 'Plat\u202eform'],
  ])('rejects a project name %s before resolving the repository', async (_case, name) => {
    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name,
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(integrations.resolveSourceRepository).not.toHaveBeenCalled();
  });

  test('lists projects for a workspace with source references', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/projects?workspace_id=${workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(createRes.statusCode).toBe(201);
    expect(res.statusCode).toBe(200);
    expect(res.json().projects.map((project: {id: string}) => project.id)).toContain(
      createRes.json().id,
    );
    expect(res.json().projects[0].source.connection_id).toBe(sourceConnectionId);
  });

  test('filters projects by `search` (case-insensitive substring on name)', async () => {
    const names = ['Platform', 'Runner', 'Notifier'];
    for (const [index, name] of names.entries()) {
      vi.mocked(integrations.resolveSourceRepository).mockResolvedValueOnce({
        connection: {
          id: sourceConnectionId,
          provider: 'gitea',
          slug: 'gitea_owner',
        },
        repository: {
          externalRepositoryId: `gitea:gitea-owner/${name.toLowerCase()}-${index}`,
          owner: 'gitea-owner',
          name: name.toLowerCase(),
          fullName: `gitea-owner/${name.toLowerCase()}`,
          defaultBranch: 'main',
          visibility: 'private',
          cloneUrl: `https://gitea.local/gitea-owner/${name.toLowerCase()}.git`,
          htmlUrl: `https://gitea.local/gitea-owner/${name.toLowerCase()}`,
        },
      });
      await app.inject({
        method: 'POST',
        url: '/projects',
        headers: {authorization: 'Bearer user'},
        payload: {
          workspace_id: workspaceId,
          name,
          source: {
            connection_id: sourceConnectionId,
            external_repository_id: `gitea:gitea-owner/${name.toLowerCase()}-${index}`,
          },
        },
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/projects?workspace_id=${workspaceId}&search=runn`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    const returned = res.json().projects.map((project: {name: string}) => project.name);
    expect(returned).toEqual(['Runner']);
  });

  test('returns 409 when the source repository already has a project', async () => {
    const payload = {
      workspace_id: workspaceId,
      name: 'Platform',
      source: {
        connection_id: sourceConnectionId,
        external_repository_id: 'gitea:gitea-owner/platform',
      },
    };
    await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('project-already-exists');
    expect(res.json().details.source_connection_id).toBe(sourceConnectionId);
  });

  test('maps missing source connections to a stable error', async () => {
    vi.mocked(integrations.resolveSourceRepository).mockRejectedValueOnce(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        'connection-not-found',
        {connectionId: sourceConnectionId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: {authorization: 'Bearer user'},
      payload: {
        workspace_id: workspaceId,
        name: 'Platform',
        source: {
          connection_id: sourceConnectionId,
          external_repository_id: 'gitea:gitea-owner/platform',
        },
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('source-connection-not-found');
  });
});
