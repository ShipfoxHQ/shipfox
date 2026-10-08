import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  type AgentAccessContext,
  AUTH_AGENT_ACCESS,
  setAgentAccessContext,
} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  type FastifyRequest,
} from '@shipfox/node-fastify';
import {createDocsCache} from '#core/docs.js';
import {agentAccessSuccess} from '#core/envelope.js';
import {createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {createAgentAccessFixtureTool} from '#core/tools.js';
import {type CreateAgentAccessRoutesOptions, createAgentAccessRoutes} from './routes.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const WINDOW_ID = '44444444-4444-4444-8444-444444444444';
const STARTED_AT = '2026-10-08T10:00:00.000Z';
const DEADLINE_AT = '2026-10-08T11:00:00.000Z';

const context: AgentAccessContext = {
  userId: ACTOR_ID,
  workspaceId: WORKSPACE_ID,
  credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
};

const testAuth: AuthMethod = {
  name: AUTH_AGENT_ACCESS,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer valid-token') {
      throw new ClientError('Missing or invalid Authorization header', 'unauthorized', {
        status: 401,
      });
    }
    setAgentAccessContext(request, context);
    return Promise.resolve();
  },
};

const ROLE_RANK = {'admin-observer': 0, 'admin-operator': 1, 'admin-owner': 2} as const;

function createAuthClient(role: keyof typeof ROLE_RANK | null) {
  return {
    requireAdminRole: vi.fn(({minimumRole}: {minimumRole: keyof typeof ROLE_RANK}) => {
      if (role === null || ROLE_RANK[role] < ROLE_RANK[minimumRole]) {
        throw createInterModuleKnownError(
          authInterModuleContract.methods.requireAdminRole,
          'admin-role-required',
          {requiredRole: minimumRole},
        );
      }
      return Promise.resolve({role});
    }),
    listImpersonationEligibleUserSummaries: vi.fn(() =>
      Promise.resolve({
        users: [
          {
            id: USER_ID,
            email: 'customer@example.test',
            name: 'Customer',
            status: 'active' as const,
            emailVerifiedAt: STARTED_AT,
            createdAt: STARTED_AT,
            adminRole: null,
          },
        ],
        nextCursor: null,
      }),
    ),
    startImpersonationWindow: vi.fn(({workspaceId}: {workspaceId: string}) =>
      Promise.resolve({
        windowId: WINDOW_ID,
        workspaceId,
        startedAt: STARTED_AT,
        deadlineAt: DEADLINE_AT,
      }),
    ),
    stopImpersonationWindow: vi.fn(() =>
      Promise.resolve({windowId: WINDOW_ID, endedAt: DEADLINE_AT}),
    ),
    checkAgentGrantAuthority: vi.fn(() => Promise.resolve({ok: true as const})),
  };
}

const workspaces = {
  listMembershipsForTokenClaims: vi.fn(() =>
    Promise.resolve({
      memberships: [
        {
          workspaceId: WORKSPACE_ID,
          workspaceSlug: 'acme',
          role: 'admin' as const,
          workspaceStatus: 'active' as const,
        },
      ],
    }),
  ),
} as unknown as WorkspacesInterModuleClient;

describe('admin MCP endpoint', () => {
  beforeEach(async () => {
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('is not mounted when the flag is off', async () => {
    const app = await createTestApp({adminMcpEnabled: false});

    const response = await app.inject({
      method: 'POST',
      url: '/mcp/admin',
      headers: {authorization: 'Bearer valid-token'},
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  test('is not mounted by default', async () => {
    const app = await createTestApp({});

    const response = await app.inject({
      method: 'POST',
      url: '/mcp/admin',
      headers: {authorization: 'Bearer valid-token'},
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  test('refuses to start without the auth and workspaces clients', () => {
    expect(() => createTestRoutes({adminMcpEnabled: true})).toThrow(
      'The admin MCP endpoint requires the auth and workspaces clients',
    );
  });

  test('rejects duplicate additional admin tools at startup', () => {
    const duplicate = {...createAgentAccessFixtureTool(), name: 'find_users'};

    expect(() =>
      createTestRoutes({
        adminMcpEnabled: true,
        auth: createAuthClient('admin-owner') as unknown as AuthInterModuleClient,
        workspaces,
        additionalAdminTools: [duplicate],
      }),
    ).toThrow('Duplicate agent-access tool: find_users');
  });

  test('answers 401 with the /mcp challenge when the token is missing', async () => {
    const app = await createTestApp({auth: createAuthClient('admin-owner')});

    const response = await app.inject({method: 'POST', url: '/mcp/admin', payload: {}});

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="https://api.example.test/.well-known/oauth-protected-resource"',
    );
  });

  test('refuses an origin the /mcp guard refuses', async () => {
    const app = await createTestApp({auth: createAuthClient('admin-owner')});

    const response = await app.inject({
      method: 'POST',
      url: '/mcp/admin',
      headers: {authorization: 'Bearer valid-token', origin: 'https://evil.example.test'},
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  test('refuses every call from a user without an admin role', async () => {
    const auth = createAuthClient(null);
    const recordCall = vi.fn();
    const {client, close} = await connect({auth, recordCall});

    const findUsers = await callTool(client, 'find_users', {search: 'customer'});
    const start = await callTool(client, 'start_impersonation', {workspace_id: WORKSPACE_ID});
    const unknown = await callTool(client, 'does_not_exist', {});
    await close();

    for (const result of [findUsers, start, unknown]) {
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        ok: false,
        error: {code: 'admin-role-required'},
      });
    }
    expect(auth.listImpersonationEligibleUserSummaries).not.toHaveBeenCalled();
    expect(auth.startImpersonationWindow).not.toHaveBeenCalled();
    expect(recordCall).toHaveBeenCalledTimes(3);
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'find_users',
        outcome: 'tool-error',
        errorCode: 'admin-role-required',
        context: {...context, admin: {actorId: ACTOR_ID}},
      }),
    );
  });

  test('requires the operator role for the impersonation tools only', async () => {
    const auth = createAuthClient('admin-observer');
    const {client, close} = await connect({auth});

    const findUsers = await callTool(client, 'find_users', {search: 'customer'});
    const start = await callTool(client, 'start_impersonation', {workspace_id: WORKSPACE_ID});
    const stop = await callTool(client, 'stop_impersonation', {workspace_id: WORKSPACE_ID});
    await close();

    expect(findUsers.isError).toBeUndefined();
    expect(start.structuredContent).toEqual({ok: false, error: {code: 'admin-role-required'}});
    expect(stop.structuredContent).toEqual({ok: false, error: {code: 'admin-role-required'}});
    expect(auth.requireAdminRole).toHaveBeenCalledWith({
      userId: ACTOR_ID,
      minimumRole: 'admin-observer',
    });
    expect(auth.requireAdminRole).toHaveBeenCalledWith({
      userId: ACTOR_ID,
      minimumRole: 'admin-operator',
    });
  });

  test('lists only the admin tools and no resources', async () => {
    const {client, close} = await connect({auth: createAuthClient('admin-operator')});

    const tools = await client.listTools();
    const capabilities = client.getServerCapabilities();
    await close();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'find_users',
      'start_impersonation',
      'stop_impersonation',
    ]);
    expect(capabilities?.resources).toBeUndefined();
  });

  test('finds users with their workspaces', async () => {
    const auth = createAuthClient('admin-observer');
    const {client, close} = await connect({auth});

    const result = await callTool(client, 'find_users', {search: 'customer', limit: 5});
    await close();

    expect(result.structuredContent).toEqual({
      ok: true,
      result: {
        users: [
          {
            id: USER_ID,
            email: 'customer@example.test',
            name: 'Customer',
            status: 'active',
            admin_role: null,
            workspaces: [
              {workspace_id: WORKSPACE_ID, workspace_slug: 'acme', role: 'admin', status: 'active'},
            ],
          },
        ],
        next_cursor: null,
      },
    });
    expect(auth.listImpersonationEligibleUserSummaries).toHaveBeenCalledWith({
      search: 'customer',
      limit: 5,
    });
  });

  test('opens and stops a window for the authenticated administrator', async () => {
    const auth = createAuthClient('admin-operator');
    const {client, close} = await connect({auth});

    const first = await callTool(client, 'start_impersonation', {workspace_id: WORKSPACE_ID});
    const second = await callTool(client, 'start_impersonation', {workspace_id: WORKSPACE_ID});
    const stop = await callTool(client, 'stop_impersonation', {workspace_id: WORKSPACE_ID});
    await close();

    const window = {
      window_id: WINDOW_ID,
      workspace_id: WORKSPACE_ID,
      started_at: STARTED_AT,
      deadline_at: DEADLINE_AT,
    };
    expect(first.structuredContent).toEqual({ok: true, result: window});
    expect(second.structuredContent).toEqual({ok: true, result: window});
    expect(stop.structuredContent).toEqual({
      ok: true,
      result: {window_id: WINDOW_ID, workspace_id: WORKSPACE_ID, ended_at: DEADLINE_AT},
    });
    expect(auth.startImpersonationWindow).toHaveBeenCalledWith(
      expect.objectContaining({actorId: ACTOR_ID, workspaceId: WORKSPACE_ID}),
    );
    expect(auth.stopImpersonationWindow).toHaveBeenCalledWith(
      expect.objectContaining({actorId: ACTOR_ID, workspaceId: WORKSPACE_ID}),
    );
  });

  test('returns the contract error code when a window cannot be opened', async () => {
    const auth = createAuthClient('admin-operator');
    auth.startImpersonationWindow.mockRejectedValueOnce(
      createInterModuleKnownError(
        authInterModuleContract.methods.startImpersonationWindow,
        'impersonation-window-limit-reached',
        {},
      ),
    );
    const {client, close} = await connect({auth});

    const result = await callTool(client, 'start_impersonation', {workspace_id: WORKSPACE_ID});
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {code: 'impersonation-window-limit-reached'},
    });
  });

  test('puts the administrator on the audit record of every outcome', async () => {
    const auth = createAuthClient('admin-operator');
    auth.stopImpersonationWindow.mockRejectedValueOnce(
      createInterModuleKnownError(
        authInterModuleContract.methods.stopImpersonationWindow,
        'impersonation-window-closed',
        {},
      ),
    );
    const recordCall = vi.fn();
    const rateLimiter = createAgentAccessRateLimiter({limit: 4, now: () => 1_000});
    const {client, close} = await connect({auth, recordCall, rateLimiter});

    await callTool(client, 'start_impersonation', {workspace_id: WORKSPACE_ID});
    await callTool(client, 'stop_impersonation', {workspace_id: WORKSPACE_ID});
    await callTool(client, 'start_impersonation', {workspace_id: 'not-a-uuid'});
    await callTool(client, 'find_users', {search: 'customer'});
    await callTool(client, 'find_users', {search: 'customer'});
    await close();

    const admin = {actorId: ACTOR_ID};
    const outcomes = recordCall.mock.calls.map(([record]) => ({
      tool: record.tool,
      outcome: record.outcome,
      context: record.context,
    }));
    expect(outcomes).toEqual([
      {
        tool: 'start_impersonation',
        outcome: 'success',
        context: {...context, admin: {...admin, windowId: WINDOW_ID}},
      },
      {tool: 'stop_impersonation', outcome: 'tool-error', context: {...context, admin}},
      {tool: 'start_impersonation', outcome: 'invalid-request', context: {...context, admin}},
      {tool: 'find_users', outcome: 'success', context: {...context, admin}},
      {tool: 'find_users', outcome: 'rate-limited', context: {...context, admin}},
    ]);
  });

  test('keeps the customer endpoint free of the admin marker', async () => {
    const recordCall = vi.fn();
    const app = await createTestApp({
      auth: createAuthClient('admin-owner'),
      recordCall,
      additionalTools: [{...createAgentAccessFixtureTool(), name: 'customer_fixture'}],
    });
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp', address), {
        requestInit: {headers: {authorization: 'Bearer valid-token'}},
      }) as unknown as Transport,
    );

    const tools = await client.listTools();
    await client.callTool(
      {name: 'customer_fixture', arguments: {message: 'hello'}},
      CallToolResultSchema,
    );
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).not.toContain('find_users');
    expect(recordCall).toHaveBeenCalledWith(expect.objectContaining({context}));
  });

  test('serves additional admin tools behind the same role check', async () => {
    const auth = createAuthClient('admin-observer');
    const extra = {
      ...createAgentAccessFixtureTool(),
      name: 'extra_admin_tool',
      minimumAdminRole: 'admin-owner' as const,
      execute: () => agentAccessSuccess({message: 'ok'}),
    };
    const {client, close} = await connect({auth, additionalAdminTools: [extra]});

    const tools = await client.listTools();
    const result = await callTool(client, 'extra_admin_tool', {message: 'x'});
    await close();

    expect(tools.tools.map((tool) => tool.name)).toContain('extra_admin_tool');
    expect(result.structuredContent).toEqual({ok: false, error: {code: 'admin-role-required'}});
  });
});

async function connect(options: {
  auth: ReturnType<typeof createAuthClient>;
  recordCall?: CreateAgentAccessRoutesOptions['recordCall'];
  rateLimiter?: CreateAgentAccessRoutesOptions['rateLimiter'];
  additionalAdminTools?: CreateAgentAccessRoutesOptions['additionalAdminTools'];
}) {
  const app = await createTestApp(options);
  const address = await app.listen({port: 0, host: '127.0.0.1'});
  const client = new Client({name: 'test-http-client', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL('/mcp/admin', address), {
    requestInit: {headers: {authorization: 'Bearer valid-token'}},
  });
  await client.connect(transport as unknown as Transport);
  return {client, close: () => client.close()};
}

function callTool(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({name, arguments: args}, CallToolResultSchema);
}

async function createTestApp(
  options: Omit<CreateAgentAccessRoutesOptions, 'auth'> & {
    auth?: ReturnType<typeof createAuthClient> | undefined;
  },
) {
  const app = await createApp({
    auth: [testAuth],
    routes: [
      createTestRoutes({
        apiPublicUrl: 'https://api.example.test/',
        isOriginAllowed: (origin) =>
          origin === undefined || origin === 'https://allowed.example.test',
        adminMcpEnabled: options.auth !== undefined,
        workspaces,
        ...options,
        auth: options.auth as unknown as AuthInterModuleClient | undefined,
      }),
    ],
    swagger: false,
  });
  await app.ready();
  return app;
}

function createTestRoutes(options: CreateAgentAccessRoutesOptions) {
  return createAgentAccessRoutes({
    docs: createDocsCache({
      baseUrl: 'https://docs.example.test/docs',
      fetch: () => {
        throw new Error('Unexpected documentation fetch in route test');
      },
    }),
    ...options,
  });
}
