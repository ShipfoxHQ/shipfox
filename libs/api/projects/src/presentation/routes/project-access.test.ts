import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createTestFeatureFlags} from '@shipfox/node-feature-flags/testing';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects} from '#db/schema/projects.js';
import {projectFactory} from '#test/index.js';
import {createProjectRoutes} from './index.js';

let memberships: UserContextMembership[] = [];
let impersonatorId: string | undefined;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        name: 'User One',
        memberships,
        impersonatorId,
      }),
    );
    return Promise.resolve();
  },
};

type ScopeConnection = NonNullable<
  Awaited<ReturnType<IntegrationsModuleClient['getScopeConnection']>>
>;

function githubConnection(overrides: Partial<ScopeConnection> = {}): ScopeConnection {
  return {
    id: crypto.randomUUID(),
    provider: 'github',
    slug: 'github_acme',
    displayName: 'GitHub, acme',
    lifecycleStatus: 'active',
    internal: false,
    resourceKinds: [{kind: 'repository', label: 'Repositories'}],
    ...overrides,
  };
}

function repositoryResource(id: string, fullName: string) {
  return {
    kind: 'repository',
    externalId: id,
    lookupName: fullName.toLowerCase(),
    displayName: fullName,
  };
}

describe('project access routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let connections: Map<string, ScopeConnection>;
  let resources: Map<string, ReturnType<typeof repositoryResource>>;
  let integrations: Pick<
    IntegrationsModuleClient,
    | 'getScopeConnection'
    | 'resolveScopeResource'
    | 'resolveConnectionById'
    | 'resolveSourceRepository'
    | 'createManagedRepository'
    | 'deleteManagedRepository'
  >;

  function addConnection(overrides: Partial<ScopeConnection> = {}): ScopeConnection {
    const connection = githubConnection(overrides);
    connections.set(connection.id, connection);
    return connection;
  }

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    memberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    impersonatorId = undefined;
    connections = new Map();
    resources = new Map([
      ['github:1', repositoryResource('github:1', 'acme-oss/SDK')],
      ['github:2', repositoryResource('github:2', 'acme-oss/docs')],
    ]);
    integrations = {
      getScopeConnection: vi.fn(({connectionId}) =>
        Promise.resolve(connections.get(connectionId) ?? null),
      ),
      resolveScopeResource: vi.fn(({externalId}) =>
        Promise.resolve(resources.get(externalId) ?? null),
      ),
      resolveConnectionById: vi.fn(({connectionId}) => {
        const connection = connections.get(connectionId);
        return Promise.resolve(
          connection
            ? {
                id: connection.id,
                workspaceId,
                provider: connection.provider,
                slug: connection.slug,
                displayName: connection.displayName,
                lifecycleStatus: connection.lifecycleStatus,
              }
            : null,
        );
      }),
      resolveSourceRepository: vi.fn(),
      createManagedRepository: vi.fn(),
      deleteManagedRepository: vi.fn(),
    };
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createProjectRoutes(
        integrations as IntegrationsModuleClient,
        {requireAdminRole: vi.fn()} as Pick<AuthInterModuleClient, 'requireAdminRole'>,
        createTestFeatureFlags(),
      ),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  function put(projectId: string, payload: unknown) {
    return app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/access`,
      headers: {authorization: 'Bearer user'},
      payload: payload as never,
    });
  }

  function get(projectId: string) {
    return app.inject({
      method: 'GET',
      url: `/projects/${projectId}/access`,
      headers: {authorization: 'Bearer user'},
    });
  }

  test('reads all connections for a project that never set its access', async () => {
    const project = await projectFactory.create({workspaceId});

    const res = await get(project.id);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      project_id: project.id,
      config_source: {
        kind: 'linked',
        connection_id: project.sourceConnectionId,
        external_repository_id: project.sourceExternalRepositoryId,
        lookup_name: null,
      },
      connections: 'all',
    });
  });

  test('lets a member read the access', async () => {
    memberships = [
      {workspaceId, role: 'member' as UserContextMembership['role'], workspaceStatus: 'active'},
    ];
    const project = await projectFactory.create({workspaceId});

    const res = await get(project.id);

    expect(res.statusCode).toBe(200);
  });

  test('does not show a project to a user outside its workspace', async () => {
    const project = await projectFactory.create({workspaceId: crypto.randomUUID()});

    const res = await get(project.id);

    expect(res.statusCode).toBe(403);
  });

  test('stores a list of connections with resolved names and reads it back', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection({displayName: 'GitHub, acme-oss'});
    const linear = addConnection({provider: 'linear', displayName: 'Linear', resourceKinds: []});

    const res = await put(project.id, {
      connections: [
        {connection_id: oss.id, resources: [{kind: 'repository', external_id: 'github:1'}]},
        {connection_id: linear.id, resources: 'all'},
      ],
    });

    expect(res.statusCode).toBe(200);
    const byConnectionId = (a: {connection_id: string}, b: {connection_id: string}) =>
      a.connection_id.localeCompare(b.connection_id);
    const expectedConnections = [
      {
        connection_id: oss.id,
        provider: 'github',
        display_name: 'GitHub, acme-oss',
        resources: [
          {
            kind: 'repository',
            external_id: 'github:1',
            lookup_name: 'acme-oss/sdk',
            display_name: 'acme-oss/SDK',
          },
        ],
      },
      {connection_id: linear.id, provider: 'linear', display_name: 'Linear', resources: 'all'},
    ].sort(byConnectionId);
    const read = (await get(project.id)).json();
    expect(res.json().connections).toEqual(read.connections);
    expect([...res.json().connections].sort(byConnectionId)).toEqual(expectedConnections);
    expect([...read.connections].sort(byConnectionId)).toEqual(expectedConnections);
    expect(read.project_id).toBe(project.id);
  });

  test('writes an audit event with a summary of the new access', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();

    await put(project.id, {
      connections: [
        {connection_id: oss.id, resources: [{kind: 'repository', external_id: 'github:1'}]},
      ],
    });

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${project.id}`);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'projects.project.access_changed',
        payload: expect.objectContaining({
          actorId: 'user-1',
          workspaceId,
          correlationId: expect.any(String),
          connections: [{connectionId: oss.id, resources: {count: 1}}],
        }),
      }),
    ]);
  });

  test('replaces the previous access and resets it with all connections', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();
    await put(project.id, {
      connections: [
        {connection_id: oss.id, resources: [{kind: 'repository', external_id: 'github:1'}]},
      ],
    });
    await put(project.id, {
      connections: [
        {connection_id: oss.id, resources: [{kind: 'repository', external_id: 'github:2'}]},
      ],
    });

    const replaced = (await get(project.id)).json();
    expect(
      replaced.connections[0].resources.map((r: {external_id: string}) => r.external_id),
    ).toEqual(['github:2']);

    const reset = await put(project.id, {connections: 'all'});
    expect(reset.json().connections).toBe('all');
    expect((await get(project.id)).json().connections).toBe('all');
  });

  test('lets a project that lists no connection reach only its config source', async () => {
    const project = await projectFactory.create({workspaceId});

    const res = await put(project.id, {connections: []});

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toEqual([]);
  });

  test('counts the config repository of a linked project toward the resource minimum', async () => {
    const project = await projectFactory.create({workspaceId});
    addConnection({id: project.sourceConnectionId});

    const res = await put(project.id, {
      connections: [{connection_id: project.sourceConnectionId, resources: []}],
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections[0].resources).toEqual([]);
  });

  test('refuses an empty resource list on another connection', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();

    const res = await put(project.id, {connections: [{connection_id: oss.id, resources: []}]});

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({code: 'access-resource-scope-empty'});
  });

  test('refuses a connection that is missing, inactive, internal, or listed twice', async () => {
    const project = await projectFactory.create({workspaceId});
    const inactive = addConnection({lifecycleStatus: 'disabled'});
    const internal = addConnection({internal: true});
    const active = addConnection();

    const missing = await put(project.id, {
      connections: [{connection_id: crypto.randomUUID(), resources: 'all'}],
    });
    const disabled = await put(project.id, {
      connections: [{connection_id: inactive.id, resources: 'all'}],
    });
    const hidden = await put(project.id, {
      connections: [{connection_id: internal.id, resources: 'all'}],
    });
    const twice = await put(project.id, {
      connections: [
        {connection_id: active.id, resources: 'all'},
        {connection_id: active.id, resources: 'all'},
      ],
    });

    for (const res of [missing, disabled, hidden]) {
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({code: 'access-connection-invalid'});
    }
    expect(twice.statusCode).toBe(422);
    expect(twice.json()).toMatchObject({code: 'access-connection-duplicate'});
  });

  test('refuses resources on a provider that declares no resource kind', async () => {
    const project = await projectFactory.create({workspaceId});
    const linear = addConnection({provider: 'linear', resourceKinds: []});

    const res = await put(project.id, {
      connections: [
        {connection_id: linear.id, resources: [{kind: 'repository', external_id: 'github:1'}]},
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({code: 'access-resource-kind-unsupported'});
  });

  test('refuses a resource kind other than repository', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection({
      resourceKinds: [
        {kind: 'repository', label: 'Repositories'},
        {kind: 'team', label: 'Teams'},
      ],
    });

    const res = await put(project.id, {
      connections: [{connection_id: oss.id, resources: [{kind: 'team', external_id: 't1'}]}],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({code: 'access-resource-kind-unsupported'});
  });

  test('refuses a resource the installation cannot see', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();

    const res = await put(project.id, {
      connections: [
        {connection_id: oss.id, resources: [{kind: 'repository', external_id: 'github:404'}]},
      ],
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({code: 'resource-not-found'});
  });

  test('maps a known integrations error to a client error', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();
    vi.mocked(integrations.resolveScopeResource).mockRejectedValueOnce(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveScopeResource,
        'provider-failure',
        {reason: 'rate-limited', retryAfterSeconds: 30},
      ),
    );

    const res = await put(project.id, {
      connections: [
        {connection_id: oss.id, resources: [{kind: 'repository', external_id: 'github:1'}]},
      ],
    });

    expect(res.statusCode).toBe(429);
  });

  test('stores a resource once when the request repeats it', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();

    const res = await put(project.id, {
      connections: [
        {
          connection_id: oss.id,
          resources: [
            {kind: 'repository', external_id: 'github:1'},
            {kind: 'repository', external_id: 'github:1'},
          ],
        },
      ],
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections[0].resources).toHaveLength(1);
  });

  test('stores one row when two requested spellings resolve to the same resource', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();
    resources.set('github:1-alias', resources.get('github:1') as never);

    const res = await put(project.id, {
      connections: [
        {
          connection_id: oss.id,
          resources: [
            {kind: 'repository', external_id: 'github:1'},
            {kind: 'repository', external_id: 'github:1-alias'},
          ],
        },
      ],
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections[0].resources).toHaveLength(1);
  });

  test('refuses a write when the config source moved during validation', async () => {
    const project = await projectFactory.create({workspaceId});
    addConnection({id: project.sourceConnectionId});
    vi.mocked(integrations.resolveScopeResource).mockImplementationOnce(async () => {
      await db()
        .update(projects)
        .set({sourceConnectionId: crypto.randomUUID()})
        .where(eq(projects.id, project.id));
      return resources.get('github:1') ?? null;
    });

    const res = await put(project.id, {
      connections: [
        {
          connection_id: project.sourceConnectionId,
          resources: [{kind: 'repository', external_id: 'github:1'}],
        },
      ],
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({code: 'source-changed'});
  });

  test('refuses a write from a workspace member who is not an admin', async () => {
    memberships = [
      {workspaceId, role: 'member' as UserContextMembership['role'], workspaceStatus: 'active'},
    ];
    const project = await projectFactory.create({workspaceId});

    const res = await put(project.id, {connections: 'all'});

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({code: 'forbidden'});
  });

  test('refuses a write from an impersonated session', async () => {
    impersonatorId = crypto.randomUUID();
    const project = await projectFactory.create({workspaceId});

    const res = await put(project.id, {connections: 'all'});

    expect(res.statusCode).toBe(403);
  });

  test('answers not found for a missing project', async () => {
    const res = await put(crypto.randomUUID(), {connections: 'all'});

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({code: 'project-not-found'});
  });

  test('rejects a body that lists more than the limit of resources', async () => {
    const project = await projectFactory.create({workspaceId});
    const oss = addConnection();

    const res = await put(project.id, {
      connections: [
        {
          connection_id: oss.id,
          resources: Array.from({length: 1001}, (_, index) => ({
            kind: 'repository',
            external_id: `github:${index}`,
          })),
        },
      ],
    });

    expect(res.statusCode).toBe(400);
  });
});
