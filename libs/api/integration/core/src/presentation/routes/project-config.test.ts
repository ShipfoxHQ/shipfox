import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {IntegrationProviderError} from '#core/errors.js';
import {createManagedProjectRepository} from '#core/managed-repositories.js';
import {upsertIntegrationConnection} from '#db/connections.js';
import type {IntegrationProvider} from '#index.js';
import {createFakeHost, createFakeProjects} from '#test/fixtures/config-link.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);

describe('project config routes', () => {
  const context = useIntegrationRouteTest();

  async function setup(
    source: Partial<
      NonNullable<NonNullable<IntegrationProvider['adapters']>['source_control']>
    > = {},
    project: {externalRepositoryId?: string} = {},
  ) {
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    const projectId = crypto.randomUUID();
    const projects = {
      getProjectById: async ({projectId: id}: {projectId: string}) => {
        await Promise.resolve();
        return {
          project:
            id === projectId
              ? {
                  id: projectId,
                  workspaceId: context.workspaceId,
                  sourceConnectionId: connection.id,
                  sourceExternalRepositoryId:
                    project.externalRepositoryId ?? 'gitea:gitea-owner/platform',
                  sourceRepositoryOwner: 'gitea-owner',
                  sourceRepositoryName: 'platform',
                  sourceDefaultBranch: 'main',
                  name: 'Platform',
                }
              : null,
        };
      },
    } as unknown as ProjectsModuleClient;
    const base = sourceProvider().adapters?.source_control;
    if (!base) throw new Error('source provider has no source control adapter');
    const app = await createTestApp(
      [
        sourceProvider({
          adapters: {
            source_control: {
              ...base,
              resolveRef: async (input) => {
                await Promise.resolve();
                return {ref: input.ref, commit: HEAD};
              },
              ...source,
            },
          },
        }),
      ],
      {projects},
    );
    return {app, projectId, connection};
  }

  const headers = {authorization: 'Bearer user'};

  /** An app whose caller belongs to a different workspace than the project. */
  async function outsiderApp(projectId: string) {
    return await createTestApp([sourceProvider()], {
      memberships: [{workspaceId: crypto.randomUUID(), role: 'admin', workspaceStatus: 'active'}],
      projects: {
        getProjectById: async () => {
          await Promise.resolve();
          return {
            project: {
              id: projectId,
              workspaceId: context.workspaceId,
              sourceConnectionId: crypto.randomUUID(),
              sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
              name: 'Platform',
            },
          };
        },
      } as unknown as ProjectsModuleClient,
    });
  }

  describe('GET /projects/:projectId/config', () => {
    it('returns the source from the project row and the head of the default branch', async () => {
      const {app, projectId, connection} = await setup();

      const res = await app.inject({method: 'GET', url: `/projects/${projectId}/config`, headers});

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        source: {
          kind: 'linked',
          provider: 'gitea',
          connection_id: connection.id,
          external_repository_id: 'gitea:gitea-owner/platform',
          owner: 'gitea-owner',
          name: 'platform',
          default_branch: 'main',
        },
        head: {ref: 'refs/heads/main', commit: HEAD},
        history_supported: false,
        move: null,
        pull_request: null,
      });
    });

    it('reports a managed source', async () => {
      const {app, projectId} = await setup(
        {},
        {externalRepositoryId: `managed-vcs:${crypto.randomUUID()}`},
      );

      const res = await app.inject({method: 'GET', url: `/projects/${projectId}/config`, headers});

      expect(res.json().source.kind).toBe('managed');
    });

    it('still returns the source when the provider is down', async () => {
      const {app, projectId} = await setup({
        resolveRef: async () => {
          await Promise.resolve();
          throw new IntegrationProviderError('provider-unavailable', 'GitHub is down');
        },
      });

      const res = await app.inject({method: 'GET', url: `/projects/${projectId}/config`, headers});

      expect(res.statusCode).toBe(200);
      expect(res.json().head).toBeNull();
      expect(res.json().source).toMatchObject({owner: 'gitea-owner', name: 'platform'});
    });

    it('answers project-not-found for a missing project', async () => {
      const {app} = await setup();

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${crypto.randomUUID()}/config`,
        headers,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('project-not-found');
    });

    it('answers project-not-found for a project in another workspace', async () => {
      const {projectId} = await setup();
      const outsider = await outsiderApp(projectId);

      const res = await outsider.inject({
        method: 'GET',
        url: `/projects/${projectId}/config`,
        headers,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('project-not-found');
    });

    it('requires authentication', async () => {
      const {app, projectId} = await setup();

      const res = await app.inject({method: 'GET', url: `/projects/${projectId}/config`});

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /projects/:projectId/config/files', () => {
    it('lists the files under .shipfox at the commit the default branch points at', async () => {
      const listFiles = vi.fn(async () => {
        await Promise.resolve();
        return {
          files: [{path: '.shipfox/workflows/ci.yml', type: 'file' as const, size: 64}],
          nextCursor: null,
        };
      });
      const {app, projectId} = await setup({listFiles});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/files`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        commit: HEAD,
        files: [{path: '.shipfox/workflows/ci.yml', type: 'file', size: 64}],
        next_cursor: null,
      });
      expect(listFiles).toHaveBeenCalledWith(
        expect.objectContaining({ref: HEAD, prefix: '.shipfox/', limit: 200}),
      );
    });

    it('reads a pinned commit and forwards the cursor and limit', async () => {
      const listFiles = vi.fn(async () => {
        await Promise.resolve();
        return {files: [], nextCursor: null};
      });
      const resolveRef = vi.fn();
      const {app, projectId} = await setup({listFiles, resolveRef});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/files?ref=${OLDER}&limit=10&cursor=next`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().commit).toBe(OLDER);
      expect(resolveRef).not.toHaveBeenCalled();
      expect(listFiles).toHaveBeenCalledWith(
        expect.objectContaining({ref: OLDER, limit: 10, cursor: 'next'}),
      );
    });

    it('maps provider failures to a stable error code', async () => {
      const {app, projectId} = await setup({
        listFiles: async () => {
          await Promise.resolve();
          throw new IntegrationProviderError('rate-limited', 'Slow down', 30);
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/files`,
        headers,
      });

      expect(res.statusCode).toBe(429);
      expect(res.json().code).toBe('rate-limited');
    });

    it('answers project-not-found for a project in another workspace', async () => {
      const {projectId} = await setup();
      const outsider = await outsiderApp(projectId);

      const res = await outsider.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/files`,
        headers,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('project-not-found');
    });
  });

  describe('GET /projects/:projectId/config/files/*', () => {
    it('reads one file at the head commit', async () => {
      const fetchFile = vi.fn(async (input: {path: string; ref: string}) => {
        await Promise.resolve();
        return {path: input.path, ref: input.ref, content: 'name: CI\n'};
      });
      const {app, projectId} = await setup({fetchFile});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/files/.shipfox/workflows/ci.yml`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        path: '.shipfox/workflows/ci.yml',
        commit: HEAD,
        content: 'name: CI\n',
      });
      expect(fetchFile).toHaveBeenCalledWith(
        expect.objectContaining({ref: HEAD, path: '.shipfox/workflows/ci.yml'}),
      );
    });

    it.each([
      'src/index.ts',
      '.shipfox/workflows/../../secrets.yml',
      '.shipfox/.git/config',
    ])('rejects the path outside the config tree: %s', async (path) => {
      const fetchFile = vi.fn();
      const {app, projectId} = await setup({fetchFile});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/files/${encodeURIComponent(path).replaceAll('%2F', '/')}`,
        headers,
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
      expect(fetchFile).not.toHaveBeenCalled();
    });

    it('maps a missing file to a stable error code', async () => {
      const {app, projectId} = await setup({
        fetchFile: async () => {
          await Promise.resolve();
          throw new IntegrationProviderError('file-not-found', 'No such file');
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/files/.shipfox/workflows/missing.yml`,
        headers,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('file-not-found');
    });
  });

  describe('GET /projects/:projectId/config/commits', () => {
    const commitPage = {
      commits: [
        {
          oid: HEAD,
          message: 'Add CI',
          authorName: 'Ada',
          authoredAt: new Date('2026-10-01T10:00:00.000Z'),
          htmlUrl: 'https://gitea.local/commit/1',
        },
      ],
      nextCursor: 'page-2',
    };

    it('lists the commits that changed a path', async () => {
      const listCommits = vi.fn(async () => {
        await Promise.resolve();
        return commitPage;
      });
      const {app, projectId} = await setup({listCommits});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/commits?path=.shipfox/workflows/ci.yml&limit=5&ref=${OLDER}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        commit: OLDER,
        commits: [
          {
            oid: HEAD,
            message: 'Add CI',
            author_name: 'Ada',
            authored_at: '2026-10-01T10:00:00.000Z',
            html_url: 'https://gitea.local/commit/1',
          },
        ],
        next_cursor: 'page-2',
      });
      expect(listCommits).toHaveBeenCalledWith(
        expect.objectContaining({ref: OLDER, path: '.shipfox/workflows/ci.yml', limit: 5}),
      );
    });

    it('defaults to every config change on the default branch', async () => {
      const listCommits = vi.fn(async () => {
        await Promise.resolve();
        return {commits: [], nextCursor: null};
      });
      const {app, projectId} = await setup({listCommits});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/commits`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().commit).toBe(HEAD);
      expect(listCommits).toHaveBeenCalledWith(
        expect.objectContaining({ref: HEAD, path: '.shipfox', limit: 20}),
      );
    });

    it('lists history only for the project config tree', async () => {
      const listCommits = vi.fn();
      const {app, projectId} = await setup({listCommits});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/commits?path=src`,
        headers,
      });

      expect(res.statusCode).toBe(400);
      expect(listCommits).not.toHaveBeenCalled();
    });

    it('answers a stable error when the provider keeps no history', async () => {
      const {app, projectId} = await setup();

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/config/commits`,
        headers,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('integration-history-unsupported');
    });
  });
});

describe('project config link routes', () => {
  const context = useIntegrationRouteTest();
  const headers = {authorization: 'Bearer user'};
  const WORKFLOW = '.shipfox/workflows/triage.yml';

  async function setup() {
    const managed = await import('@shipfox/api-integration-managed-vcs');
    const {host, provider} = createFakeHost();
    const fakeProjects = createFakeProjects(context.workspaceId);
    const target = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    const projectId = crypto.randomUUID();
    const repository = await createManagedProjectRepository({
      workspaceId: context.workspaceId,
      projectId,
      files: [{path: WORKFLOW, content: 'name: Triage\n'}],
    });
    fakeProjects.rows.set(projectId, {
      id: projectId,
      workspaceId: context.workspaceId,
      connectionId: repository.connectionId,
      externalRepositoryId: repository.externalRepositoryId,
      owner: 'shipfox',
      name: repository.externalRepositoryId,
      defaultBranch: 'main',
    });
    const app = await createTestApp(
      [
        {
          provider: 'managed-vcs',
          displayName: 'Shipfox',
          internal: true,
          adapters: {
            source_control: new managed.ManagedSourceControlProvider() as never,
          },
        },
        provider,
      ],
      {projects: fakeProjects.client as unknown as ProjectsModuleClient},
    );
    const body = (overrides: Record<string, unknown> = {}) => ({
      connection_id: target.id,
      external_repository_id: host.externalRepositoryId,
      ...overrides,
    });
    return {app, projectId, host, body, rows: fakeProjects.rows};
  }

  it('checks a repository without moving anything on a dry run', async () => {
    const {app, projectId, host, body} = await setup();

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/config/link`,
      headers,
      payload: body({dry_run: true}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'ready',
      file_count: 1,
      pull_request: null,
      repository: {full_name: 'acme/app', default_branch: 'trunk'},
    });
    expect(host.opened).toEqual([]);
  });

  it('moves the project and reports the pull request on the config read', async () => {
    const {app, projectId, body} = await setup();

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/config/link`,
      headers,
      payload: body(),
    });
    const config = await app.inject({
      method: 'GET',
      url: `/projects/${projectId}/config`,
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({status: 'linked', pull_request: {number: 1, state: 'open'}});
    expect(config.json()).toMatchObject({
      source: {kind: 'linked', provider: 'gitea', name: 'app'},
      move: {status: 'linked', started_by: 'user-1'},
      pull_request: {number: 1, state: 'open'},
    });
  });

  it('answers a refusal with its code', async () => {
    const {app, projectId, host, body} = await setup();
    host.existingFiles = [WORKFLOW];

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/config/link`,
      headers,
      payload: body(),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('config-exists');
  });

  it('answers an unconfirmed outcome as unavailable and resumes on retry', async () => {
    const {app, projectId, host, body} = await setup();
    host.failBeforeOpen = new IntegrationProviderError('timeout', 'slow');
    const request = {
      method: 'POST' as const,
      url: `/projects/${projectId}/config/link`,
      headers,
      payload: body(),
    };

    const first = await app.inject(request);
    host.failBeforeOpen = undefined;
    const config = await app.inject({method: 'GET', url: `/projects/${projectId}/config`, headers});
    const second = await app.inject(request);

    expect(first.statusCode).toBe(503);
    expect(first.json().code).toBe('move-unconfirmed');
    expect(config.json().move).toMatchObject({status: 'linking', target: {full_name: 'acme/app'}});
    expect(second.statusCode).toBe(200);
  });

  it('answers a provider refusal and leaves the project unchanged', async () => {
    const {app, projectId, host, body, rows} = await setup();
    host.failBeforeOpen = new IntegrationProviderError('access-denied', 'No permission');

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/config/link`,
      headers,
      payload: body(),
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('access-denied');
    expect(rows.get(projectId)?.externalRepositoryId).toContain('managed-vcs:');
  });

  it('refuses an impersonated session', async () => {
    const {app, projectId, body} = await setup();

    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/config/link`,
      headers: {authorization: 'Bearer impersonated'},
      payload: body(),
    });

    expect(res.statusCode).toBe(403);
  });

  it('opens a new pull request after the first closed, and refuses while it is open', async () => {
    const {app, projectId, host, body} = await setup();
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/config/link`,
      headers,
      payload: body(),
    });
    const url = `/projects/${projectId}/config/link/pull-request`;

    const whileOpen = await app.inject({method: 'POST', url, headers});
    const [first] = [...host.pullRequests.values()];
    if (first) first.state = 'closed';
    const afterClose = await app.inject({method: 'POST', url, headers});

    expect(whileOpen.statusCode).toBe(409);
    expect(whileOpen.json().code).toBe('pull-request-not-closed');
    expect(afterClose.statusCode).toBe(200);
    expect(afterClose.json().pull_request).toMatchObject({number: 2, state: 'open'});
  });
});
