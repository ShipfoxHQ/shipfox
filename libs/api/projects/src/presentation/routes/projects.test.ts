import {AUTH_USER, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {IntegrationConnectionNotFoundError} from '@shipfox/api-integration-core';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {createProjectRoutes} from './index.js';

vi.mock('@shipfox/api-auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipfox/api-auth-context')>();
  return {
    ...actual,
    requireWorkspaceAccess: vi.fn(({workspaceId}) => ({
      workspaceId,
      userId: 'user-1',
      role: 'admin',
    })),
  };
});

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(request, {
      userId: 'user-1',
      email: 'user@example.com',
      name: 'User One',
      memberships: [],
      canAccess: () => true,
      hasRole: () => true,
    });
    return Promise.resolve();
  },
};

describe('project routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let sourceConnectionId: string;
  let sourceControl: IntegrationSourceControlService;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    sourceControl = {
      getConnection: vi.fn(),
      listRepositories: vi.fn(),
      resolveRepository: vi.fn(async () => {
        await Promise.resolve();
        return {
          connection: {
            id: sourceConnectionId,
            workspaceId,
            provider: 'gitea' as const,
            externalAccountId: 'gitea-owner',
            slug: 'gitea_owner',
            displayName: 'Gitea',
            lifecycleStatus: 'active' as const,
            capabilities: ['source_control' as const],
            createdAt: new Date(),
            updatedAt: new Date(),
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
      listFiles: vi.fn(),
      fetchFile: vi.fn(),
      createCheckoutSpec: vi.fn(),
    };
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createProjectRoutes(sourceControl),
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
    expect(sourceControl.resolveRepository).not.toHaveBeenCalled();
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
      vi.mocked(sourceControl.resolveRepository).mockResolvedValueOnce({
        connection: {
          id: sourceConnectionId,
          workspaceId,
          provider: 'gitea',
          externalAccountId: 'gitea-owner',
          slug: 'gitea_owner',
          displayName: 'Gitea',
          lifecycleStatus: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
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
    vi.mocked(sourceControl.resolveRepository).mockRejectedValueOnce(
      new IntegrationConnectionNotFoundError(sourceConnectionId),
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
