import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {replaceProjectAccess} from '#db/project-access.js';
import {projects} from '#db/schema/projects.js';
import {createProjectsInterModulePresentation} from './inter-module.js';

function createClient() {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(projectsInterModuleContract);
  transport.register(createProjectsInterModulePresentation());
  transport.seal();
  return client;
}

async function insertProject(params: {
  workspaceId: string;
  connectionId: string;
  owner: string | null;
  name: string | null;
  externalRepositoryId?: string;
}) {
  const [project] = await db()
    .insert(projects)
    .values({
      workspaceId: params.workspaceId,
      sourceConnectionId: params.connectionId,
      sourceExternalRepositoryId:
        params.externalRepositoryId ?? `repository-${crypto.randomUUID()}`,
      sourceRepositoryOwner: params.owner,
      sourceRepositoryName: params.name,
      name: params.name ?? 'Project',
      slug: `p-${crypto.randomUUID().slice(0, 8)}`,
    })
    .returning({
      projectId: projects.id,
      projectSlug: projects.slug,
      connectionId: projects.sourceConnectionId,
      externalRepositoryId: projects.sourceExternalRepositoryId,
    });

  if (project === undefined) throw new Error('Project insert returned no row');
  return project;
}

async function expectUnauthorized(
  client: ReturnType<typeof createClient>,
  input: Parameters<typeof client.resolveCheckoutTarget>[0],
) {
  const error = await client.resolveCheckoutTarget(input).catch((caught) => caught);

  expect(
    isInterModuleKnownError(projectsInterModuleContract.methods.resolveCheckoutTarget, error),
  ).toBe(true);
  if (isInterModuleKnownError(projectsInterModuleContract.methods.resolveCheckoutTarget, error)) {
    expect(error.code).toBe('checkout-repository-not-authorized');
    expect(error.details).toEqual({});
  }
}

describe('Projects checkout target inter-module presentation', () => {
  test('lists workspace projects through the paginated inter-module contract', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const first = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'first',
    });
    const second = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'second',
    });
    await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      owner: 'other',
      name: 'excluded',
    });

    const firstPage = await client.listProjectsByWorkspace({workspaceId, limit: 1});
    expect(firstPage.projects).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    if (!firstPage.nextCursor) expect.fail('Expected a second project page');

    const secondPage = await client.listProjectsByWorkspace({
      workspaceId,
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.projects).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();
    const projectIds = [...firstPage.projects, ...secondPage.projects]
      .map((project) => project.id)
      .sort();
    expect(projectIds).toEqual([first.projectId, second.projectId].sort());
  });

  test('lists projects across workspaces for administrators by name', async () => {
    const client = createClient();
    const token = `admin${crypto.randomUUID().slice(0, 8)}`;
    const firstWorkspaceId = crypto.randomUUID();
    const first = await insertProject({
      workspaceId: firstWorkspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: `${token}-first`,
    });
    const second = await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: `${token}-second`,
    });

    const firstPage = await client.listAdminProjects({search: token, limit: 1});
    if (!firstPage.nextCursor) expect.fail('Expected a second project page');
    const secondPage = await client.listAdminProjects({
      search: token,
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    const exact = await client.listAdminProjects({projectId: first.projectId, limit: 10});

    expect([...firstPage.projects, ...secondPage.projects].map((project) => project.id)).toEqual([
      second.projectId,
      first.projectId,
    ]);
    expect(secondPage.nextCursor).toBeNull();
    expect(exact.projects).toEqual([
      {
        id: first.projectId,
        workspaceId: firstWorkspaceId,
        name: `${token}-first`,
        slug: first.projectSlug,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
  });

  test('lists project repositories by source connection through the producer contract', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const first = await insertProject({
      workspaceId,
      connectionId,
      owner: 'AcMe',
      name: 'Api',
      externalRepositoryId: 'github:1',
    });
    const second = await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:2',
    });
    await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'excluded',
      externalRepositoryId: 'github:3',
    });

    const firstPage = await client.listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId: connectionId,
      limit: 1,
    });

    expect(firstPage.projects).toEqual([
      {
        externalRepositoryId: 'github:1',
        owner: 'AcMe',
        name: 'Api',
        projectId: first.projectId,
        projectName: 'Api',
        projectSlug: first.projectSlug,
      },
    ]);
    expect(firstPage.nextCursor).toEqual({
      owner: 'AcMe',
      name: 'Api',
      externalRepositoryId: 'github:1',
    });

    const secondPage = await client.listProjectsBySourceConnection({
      workspaceId,
      sourceConnectionId: connectionId,
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.projects).toEqual([
      {
        externalRepositoryId: 'github:2',
        owner: 'acme',
        name: 'api',
        projectId: second.projectId,
        projectName: 'api',
        projectSlug: second.projectSlug,
      },
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  test('lists workspace projects with catalog fields through the catalog contract', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
    });

    const result = await client.listProjectCatalogByWorkspace({workspaceId, limit: 10});

    expect(result.nextCursor).toBeNull();
    expect(result.projects).toEqual([
      expect.objectContaining({
        id: project.projectId,
        slug: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ]);
  });

  test('resolves a project by its workspace-scoped source repository', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:42',
    });

    await expect(
      client.getProjectBySource({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: project.externalRepositoryId,
      }),
    ).resolves.toMatchObject({project: {id: project.projectId}});

    await expect(
      client.getProjectBySource({
        workspaceId: crypto.randomUUID(),
        sourceConnectionId: connectionId,
        sourceExternalRepositoryId: project.externalRepositoryId,
      }),
    ).resolves.toEqual({project: null});
  });

  test('finds zero, one, and multiple source repository name matches', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();

    await expect(
      client.findProjectBySourceRepositoryName({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: 'api',
      }),
    ).resolves.toEqual({projects: []});

    const first = await insertProject({
      workspaceId,
      connectionId,
      owner: 'AcMe',
      name: 'Api',
      externalRepositoryId: 'github:one',
    });
    await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:other-workspace',
    });
    await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:other-connection',
    });

    await expect(
      client.findProjectBySourceRepositoryName({
        workspaceId,
        sourceConnectionId: connectionId,
        sourceRepositoryOwner: 'ACME',
        sourceRepositoryName: 'aPI',
      }),
    ).resolves.toMatchObject({
      projects: [
        {
          id: first.projectId,
          sourceConnectionId: connectionId,
          sourceExternalRepositoryId: 'github:one',
          sourceRepositoryOwner: 'AcMe',
          sourceRepositoryName: 'Api',
        },
      ],
    });

    const second = await insertProject({
      workspaceId,
      connectionId,
      owner: 'acme',
      name: 'api',
      externalRepositoryId: 'github:two',
    });

    const multipleMatches = await client.findProjectBySourceRepositoryName({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceRepositoryOwner: 'AcMe',
      sourceRepositoryName: 'API',
    });

    expect(multipleMatches.projects).toHaveLength(2);
    expect(multipleMatches.projects.map(({id}) => id)).toEqual([first.projectId, second.projectId]);
  });

  test('resolves a project target in its workspace', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
    });

    await expect(
      client.resolveCheckoutTarget({
        workspaceId,
        target: {project: project.projectId},
      }),
    ).resolves.toEqual({
      projectId: project.projectId,
      connectionId: project.connectionId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'api',
      target: {
        kind: 'external-id',
        externalRepositoryId: project.externalRepositoryId,
      },
    });
  });

  test('rejects a project from another workspace', async () => {
    const client = createClient();
    const project = await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'api',
    });

    await expectUnauthorized(client, {
      workspaceId: crypto.randomUUID(),
      target: {project: project.projectId},
    });
  });
});

describe('Projects moveProjectSource inter-module presentation', () => {
  function input(project: {projectId: string; connectionId: string; externalRepositoryId: string}) {
    return {
      projectId: project.projectId,
      workspaceId: workspaceIdOf.get(project.projectId) ?? crypto.randomUUID(),
      actorId: 'user-1',
      from: {
        connectionId: project.connectionId,
        externalRepositoryId: project.externalRepositoryId,
      },
      to: {
        connectionId: crypto.randomUUID(),
        provider: 'github',
        externalRepositoryId: `github:${crypto.randomUUID()}`,
        owner: 'acme',
        name: 'app',
        defaultBranch: 'main',
      },
    };
  }
  const workspaceIdOf = new Map<string, string>();

  async function insert(name: string, externalRepositoryId?: string) {
    const workspaceId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'shipfox',
      name,
      ...(externalRepositoryId === undefined ? {} : {externalRepositoryId}),
    });
    workspaceIdOf.set(project.projectId, workspaceId);
    return project;
  }

  async function knownError(promise: Promise<unknown>) {
    const error = await promise.catch((caught) => caught);
    const method = projectsInterModuleContract.methods.moveProjectSource;
    if (!isInterModuleKnownError(method, error)) throw error;
    return error;
  }

  test('moves the source', async () => {
    const client = createClient();
    const project = await insert('managed');

    const moveInput = input(project);
    const result = await client.moveProjectSource(moveInput);

    expect(result).toEqual({moved: true});
    const [row] = await db().select().from(projects).where(eq(projects.id, project.projectId));
    expect(row).toMatchObject({
      sourceConnectionId: moveInput.to.connectionId,
      sourceExternalRepositoryId: moveInput.to.externalRepositoryId,
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'app',
      sourceDefaultBranch: 'main',
    });
  });

  test('reports an unknown project', async () => {
    const client = createClient();
    const project = await insert('managed');

    const error = await knownError(
      client.moveProjectSource({...input(project), projectId: crypto.randomUUID()}),
    );

    expect(error.code).toBe('project-not-found');
  });

  test('reports a source that is neither the expected one nor the target', async () => {
    const client = createClient();
    const project = await insert('managed');

    const error = await knownError(
      client.moveProjectSource({
        ...input(project),
        from: {connectionId: crypto.randomUUID(), externalRepositoryId: 'other'},
      }),
    );

    expect(error.code).toBe('source-changed');
  });

  test('reports the project that already owns the target', async () => {
    const client = createClient();
    const mover = await insert('mover');
    const owner = await insert('owner');
    const moveInput = input(mover);

    await client.moveProjectSource({
      ...input(owner),
      to: moveInput.to,
    });
    const error = await knownError(client.moveProjectSource(moveInput));

    expect(error.code).toBe('source-already-bound');
    expect(error.details).toEqual({existingProjectId: owner.projectId});
  });
});

describe('Projects access policy inter-module presentation', () => {
  const sdk = {
    kind: 'repository',
    externalId: 'github:1',
    lookupName: 'acme/sdk',
    displayName: 'acme/SDK',
  };

  test('returns all connections for a project that never set its access', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'Acme',
      name: 'Config',
      externalRepositoryId: 'github:9',
    });

    const {policy} = await client.getProjectAccessPolicy({
      workspaceId,
      projectId: project.projectId,
    });

    expect(policy).toEqual({
      projectId: project.projectId,
      configSource: {
        managed: false,
        connectionId: project.connectionId,
        externalRepositoryId: 'github:9',
        lookupName: 'acme/config',
      },
      connections: 'all',
    });
  });

  test('marks a managed config source and has no name for it', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: null,
      name: null,
      externalRepositoryId: `managed-vcs:${crypto.randomUUID()}`,
    });

    const {policy} = await client.getProjectAccessPolicy({
      workspaceId,
      projectId: project.projectId,
    });

    expect(policy.configSource).toMatchObject({managed: true, lookupName: null});
  });

  test('returns the stored scopes and resources without display names', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const linear = crypto.randomUUID();
    const project = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'config',
    });
    await db().transaction((tx) =>
      replaceProjectAccess({
        tx,
        projectId: project.projectId,
        access: {
          connectionAccess: 'selected',
          scopes: [
            {connectionId, resources: [sdk]},
            {connectionId: linear, resources: 'all'},
          ],
        },
      }),
    );

    const {policy} = await client.getProjectAccessPolicy({
      workspaceId,
      projectId: project.projectId,
    });

    expect(policy.connections).toHaveLength(2);
    expect(policy.connections).toEqual(
      expect.arrayContaining([
        {
          connectionId,
          resources: [{kind: 'repository', externalId: 'github:1', lookupName: 'acme/sdk'}],
        },
        {connectionId: linear, resources: 'all'},
      ]),
    );
  });

  test('throws project-not-found for a missing project or one of another workspace', async () => {
    const client = createClient();
    const project = await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'config',
    });

    for (const input of [
      {workspaceId: crypto.randomUUID(), projectId: crypto.randomUUID()},
      {workspaceId: crypto.randomUUID(), projectId: project.projectId},
    ]) {
      const error = await client.getProjectAccessPolicy(input).catch((caught) => caught);
      expect(
        isInterModuleKnownError(projectsInterModuleContract.methods.getProjectAccessPolicy, error),
      ).toBe(true);
      expect(error.code).toBe('project-not-found');
    }
  });

  test('returns the policies of the projects it finds and leaves the others out', async () => {
    const client = createClient();
    const workspaceId = crypto.randomUUID();
    const first = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'first',
    });
    const second = await insertProject({
      workspaceId,
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'second',
    });
    const foreign = await insertProject({
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      owner: 'acme',
      name: 'foreign',
    });

    const {policies} = await client.getProjectAccessPolicies({
      workspaceId,
      projectIds: [first.projectId, second.projectId, foreign.projectId, crypto.randomUUID()],
    });

    expect(policies.map((policy) => policy.projectId).sort()).toEqual(
      [first.projectId, second.projectId].sort(),
    );
  });
});
