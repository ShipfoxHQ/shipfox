import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {agentAccessOutputSchema} from '@shipfox/api-agent-access-dto';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  type AgentAccessContext,
  AUTH_AGENT_ACCESS,
  setAgentAccessContext,
} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {LogsModuleClient} from '@shipfox/api-logs-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RegistryInterModuleClient} from '@shipfox/api-registry-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  type FastifyRequest,
} from '@shipfox/node-fastify';
import type {TemplateLoader} from '@shipfox/workflow-templates';
import {createDocsCache} from '#core/docs.js';
import {agentAccessError, agentAccessSuccess} from '#core/envelope.js';
import {createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {type AgentAccessTool, createAgentAccessFixtureTool} from '#core/tools.js';
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
    findOpenImpersonationWindow: vi.fn(({workspaceId}: {workspaceId: string}) =>
      Promise.resolve({
        windowId: WINDOW_ID,
        workspaceId,
        startedAt: STARTED_AT,
        deadlineAt: DEADLINE_AT,
      }),
    ),
    checkAgentGrantAuthority: vi.fn(() => Promise.resolve({ok: true as const})),
  };
}

function windowClosedError() {
  return createInterModuleKnownError(
    authInterModuleContract.methods.findOpenImpersonationWindow,
    'impersonation-window-closed',
    {},
  );
}

const OTHER_WORKSPACE_ID = '55555555-5555-4555-8555-555555555555';

/** A customer read tool that reports the identity it ran with. */
function createWhoAmITool(name = 'who_am_i'): AgentAccessTool {
  const isValid = (input: unknown) =>
    typeof input === 'object' &&
    input !== null &&
    Object.keys(input).every((key) => key === 'note') &&
    (!('note' in input) || typeof input.note === 'string');
  return {
    name,
    description: 'Reports the identity the tool ran with.',
    inputSchema: {
      type: 'object',
      properties: {note: {type: 'string'}},
      additionalProperties: false,
    },
    outputSchema: agentAccessOutputSchema({type: 'object', additionalProperties: true}),
    validateInput: isValid,
    annotations: {readOnlyHint: true},
    execute: ({context: callContext, arguments: input}) =>
      input.note === 'fail'
        ? agentAccessError('not-found')
        : agentAccessSuccess({
            user_id: callContext.userId,
            workspace_id: callContext.workspaceId,
            arguments: input,
          }),
  };
}

function createActionTool(): AgentAccessTool {
  return {
    ...createWhoAmITool('do_something'),
    annotations: {readOnlyHint: false, destructiveHint: true},
  };
}

const PROJECT_ID = '66666666-6666-4666-8666-666666666666';

function createWorkspacesClient() {
  return {
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
    listAdminWorkspaces: vi.fn(() =>
      Promise.resolve({
        workspaces: [
          {
            id: WORKSPACE_ID,
            name: 'Acme',
            slug: 'acme',
            status: 'active' as const,
            memberCount: 3,
            createdAt: STARTED_AT,
            updatedAt: DEADLINE_AT,
          },
        ],
        nextCursor: {value: 'Acme', id: WORKSPACE_ID},
      }),
    ),
    getWorkspaceSummary: vi.fn(({workspaceId}: {workspaceId: string}) =>
      Promise.resolve(
        workspaceId === WORKSPACE_ID ? {id: WORKSPACE_ID, name: 'Acme', slug: 'acme'} : undefined,
      ),
    ),
  };
}

function createProjectsClient() {
  return {
    listAdminProjects: vi.fn(() =>
      Promise.resolve({
        projects: [
          {
            id: PROJECT_ID,
            workspaceId: WORKSPACE_ID,
            name: 'Checkout API',
            slug: 'checkout-api',
            createdAt: STARTED_AT,
            updatedAt: DEADLINE_AT,
          },
          {
            id: USER_ID,
            workspaceId: OTHER_WORKSPACE_ID,
            name: 'Checkout web',
            slug: 'checkout-web',
            createdAt: STARTED_AT,
            updatedAt: DEADLINE_AT,
          },
        ],
        nextCursor: {createdAt: STARTED_AT, id: USER_ID},
      }),
    ),
  };
}

const projects = createProjectsClient() as unknown as ProjectsModuleClient;

const workspaces = createWorkspacesClient() as unknown as WorkspacesInterModuleClient;

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

  test('refuses to start without the auth, workspaces, and projects clients', () => {
    expect(() =>
      createTestRoutes({
        adminMcpEnabled: true,
        auth: createAuthClient('admin-owner') as unknown as AuthInterModuleClient,
        workspaces,
      }),
    ).toThrow('The admin MCP endpoint requires the auth, workspaces, and projects clients');
  });

  test('rejects duplicate additional admin tools at startup', () => {
    const duplicate = {...createAgentAccessFixtureTool(), name: 'find_users'};

    expect(() =>
      createTestRoutes({
        adminMcpEnabled: true,
        auth: createAuthClient('admin-owner') as unknown as AuthInterModuleClient,
        workspaces,
        projects,
        tools: [],
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
    const {client, close} = await connect({auth: createAuthClient('admin-operator'), tools: []});

    const tools = await client.listTools();
    const capabilities = client.getServerCapabilities();
    await close();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'find_projects',
      'find_users',
      'find_workspaces',
      'search_docs',
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

  test('finds workspaces by name or slug and pages with an opaque cursor', async () => {
    const workspacesClient = createWorkspacesClient();
    const {client, close} = await connect({
      auth: createAuthClient('admin-observer'),
      workspaces: workspacesClient,
    });

    const first = await callTool(client, 'find_workspaces', {search: 'acme', status: 'active'});
    const nextCursor = (first.structuredContent as {result: {next_cursor: string}}).result
      .next_cursor;
    await callTool(client, 'find_workspaces', {cursor: nextCursor});
    await close();

    expect(first.structuredContent).toEqual({
      ok: true,
      result: {
        workspaces: [
          {
            id: WORKSPACE_ID,
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            member_count: 3,
            created_at: STARTED_AT,
          },
        ],
        next_cursor: expect.any(String),
      },
    });
    expect(workspacesClient.listAdminWorkspaces).toHaveBeenNthCalledWith(1, {
      search: 'acme',
      status: 'active',
      limit: 10,
    });
    expect(workspacesClient.listAdminWorkspaces).toHaveBeenNthCalledWith(2, {
      limit: 10,
      cursor: {value: 'Acme', id: WORKSPACE_ID},
    });
  });

  test('looks a workspace up by id when the search is a UUID', async () => {
    const workspacesClient = createWorkspacesClient();
    const {client, close} = await connect({
      auth: createAuthClient('admin-observer'),
      workspaces: workspacesClient,
    });

    await callTool(client, 'find_workspaces', {search: WORKSPACE_ID});
    const badCursor = await callTool(client, 'find_workspaces', {cursor: 'not-a-cursor'});
    await close();

    expect(workspacesClient.listAdminWorkspaces).toHaveBeenCalledTimes(1);
    expect(workspacesClient.listAdminWorkspaces).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      limit: 10,
    });
    expect(badCursor.structuredContent).toEqual({ok: false, error: {code: 'invalid-request'}});
  });

  test('finds projects across workspaces with their workspace slug', async () => {
    const workspacesClient = createWorkspacesClient();
    const projectsClient = createProjectsClient();
    const {client, close} = await connect({
      auth: createAuthClient('admin-observer'),
      workspaces: workspacesClient,
      projects: projectsClient,
    });

    const result = await callTool(client, 'find_projects', {search: 'checkout', limit: 2});
    await callTool(client, 'find_projects', {search: PROJECT_ID});
    await close();

    expect(result.structuredContent).toEqual({
      ok: true,
      result: {
        projects: [
          {
            id: PROJECT_ID,
            name: 'Checkout API',
            slug: 'checkout-api',
            workspace_id: WORKSPACE_ID,
            workspace_slug: 'acme',
            created_at: STARTED_AT,
          },
          {
            id: USER_ID,
            name: 'Checkout web',
            slug: 'checkout-web',
            workspace_id: OTHER_WORKSPACE_ID,
            workspace_slug: null,
            created_at: STARTED_AT,
          },
        ],
        next_cursor: expect.any(String),
      },
    });
    expect(projectsClient.listAdminProjects).toHaveBeenNthCalledWith(1, {
      search: 'checkout',
      limit: 2,
    });
    expect(projectsClient.listAdminProjects).toHaveBeenNthCalledWith(2, {
      projectId: PROJECT_ID,
      limit: 10,
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

  describe('workspace read tools', () => {
    const tools = [createWhoAmITool(), createActionTool()];

    test('lists read tools with a required workspace_id and no action tool', async () => {
      const {client, close} = await connect({auth: createAuthClient('admin-operator'), tools});

      const listed = await client.listTools();
      await close();

      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        'find_projects',
        'find_users',
        'find_workspaces',
        'search_docs',
        'start_impersonation',
        'stop_impersonation',
        'who_am_i',
      ]);
      const whoAmI = listed.tools.find((tool) => tool.name === 'who_am_i');
      expect(whoAmI?.inputSchema.required).toEqual(['workspace_id']);
      expect(whoAmI?.inputSchema.properties).toEqual({
        note: {type: 'string'},
        workspace_id: {type: 'string', format: 'uuid'},
      });
    });

    test('runs the tool as the administrator in the named workspace', async () => {
      const auth = createAuthClient('admin-operator');
      const recordCall = vi.fn();
      const {client, close} = await connect({auth, tools, recordCall});

      const result = await callTool(client, 'who_am_i', {
        workspace_id: OTHER_WORKSPACE_ID,
        note: 'hello',
      });
      await close();

      expect(result.structuredContent).toEqual({
        ok: true,
        result: {user_id: ACTOR_ID, workspace_id: OTHER_WORKSPACE_ID, arguments: {note: 'hello'}},
      });
      expect(auth.findOpenImpersonationWindow).toHaveBeenCalledWith({
        actorId: ACTOR_ID,
        workspaceId: OTHER_WORKSPACE_ID,
      });
      expect(recordCall).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'who_am_i',
          outcome: 'success',
          context: {
            ...context,
            workspaceId: OTHER_WORKSPACE_ID,
            admin: {actorId: ACTOR_ID, windowId: WINDOW_ID},
          },
        }),
      );
    });

    test('returns what the customer endpoint returns for the same workspace', async () => {
      const app = await createTestApp({auth: createAuthClient('admin-operator'), tools});
      const address = await app.listen({port: 0, host: '127.0.0.1'});
      const connectTo = async (path: string) => {
        const client = new Client({name: 'test-http-client', version: '0.0.0'});
        await client.connect(
          new StreamableHTTPClientTransport(new URL(path, address), {
            requestInit: {headers: {authorization: 'Bearer valid-token'}},
          }) as unknown as Transport,
        );
        return client;
      };
      const customerClient = await connectTo('/mcp');
      const adminClient = await connectTo('/mcp/admin');

      const customer = await callTool(customerClient, 'who_am_i', {note: 'same'});
      const admin = await callTool(adminClient, 'who_am_i', {
        workspace_id: WORKSPACE_ID,
        note: 'same',
      });
      await Promise.all([customerClient.close(), adminClient.close()]);

      expect(customer.structuredContent).toMatchObject({ok: true});
      expect(admin.structuredContent).toEqual(customer.structuredContent);
    });

    test.each([
      ['stopped, past its deadline, or never opened', windowClosedError()],
      [
        'the role was revoked',
        createInterModuleKnownError(
          authInterModuleContract.methods.findOpenImpersonationWindow,
          'admin-role-required',
          {requiredRole: 'admin-operator'},
        ),
      ],
    ])('refuses the call when the window is unavailable: %s', async (_name, error) => {
      const auth = createAuthClient('admin-operator');
      auth.findOpenImpersonationWindow.mockRejectedValueOnce(error);
      const recordCall = vi.fn();
      const {client, close} = await connect({auth, tools, recordCall});

      const result = await callTool(client, 'who_am_i', {workspace_id: OTHER_WORKSPACE_ID});
      await close();

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ok: false, error: {code: error.code}});
      expect(recordCall).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'who_am_i',
          outcome: 'tool-error',
          errorCode: error.code,
          context: {
            ...context,
            workspaceId: OTHER_WORKSPACE_ID,
            admin: {actorId: ACTOR_ID},
          },
        }),
      );
    });

    test('refuses a read tool when the administrator lost the operator role', async () => {
      const auth = createAuthClient('admin-observer');
      const {client, close} = await connect({auth, tools});

      const result = await callTool(client, 'who_am_i', {workspace_id: OTHER_WORKSPACE_ID});
      await close();

      expect(result.structuredContent).toEqual({ok: false, error: {code: 'admin-role-required'}});
      expect(auth.findOpenImpersonationWindow).not.toHaveBeenCalled();
    });

    test('rejects a missing or malformed workspace_id before any window lookup', async () => {
      const auth = createAuthClient('admin-operator');
      const recordCall = vi.fn();
      const {client, close} = await connect({auth, tools, recordCall});

      const missing = await callTool(client, 'who_am_i', {});
      const malformed = await callTool(client, 'who_am_i', {workspace_id: 'acme'});
      await close();

      for (const result of [missing, malformed]) {
        expect(result.structuredContent).toEqual({ok: false, error: {code: 'invalid-request'}});
      }
      expect(auth.findOpenImpersonationWindow).not.toHaveBeenCalled();
      expect(recordCall).toHaveBeenCalledTimes(2);
      expect(recordCall).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'invalid-request',
          context: {...context, admin: {actorId: ACTOR_ID}},
        }),
      );
    });

    test('puts the administrator and the window on every outcome', async () => {
      const recordCall = vi.fn();
      const rateLimiter = createAgentAccessRateLimiter({limit: 3, now: () => 1_000});
      const {client, close} = await connect({
        auth: createAuthClient('admin-operator'),
        tools,
        recordCall,
        rateLimiter,
      });

      await callTool(client, 'who_am_i', {workspace_id: WORKSPACE_ID});
      await callTool(client, 'who_am_i', {workspace_id: WORKSPACE_ID, note: 'fail'});
      await callTool(client, 'who_am_i', {workspace_id: WORKSPACE_ID, extra: true});
      await callTool(client, 'who_am_i', {workspace_id: WORKSPACE_ID});
      await close();

      const admin = {actorId: ACTOR_ID, windowId: WINDOW_ID};
      expect(
        recordCall.mock.calls.map(([record]) => [record.outcome, record.context.admin]),
      ).toEqual([
        ['success', admin],
        ['tool-error', admin],
        ['invalid-request', admin],
        ['rate-limited', admin],
      ]);
    });

    test('serves read tools added through additionalTools and not their action siblings', async () => {
      const {client, close} = await connect({
        auth: createAuthClient('admin-operator'),
        tools: [],
        additionalTools: [createWhoAmITool('extra_read'), createActionTool()],
      });

      const listed = await client.listTools();
      await close();

      expect(listed.tools.map((tool) => tool.name)).toContain('extra_read');
      expect(listed.tools.map((tool) => tool.name)).not.toContain('do_something');
    });

    test('rejects a read tool that already declares workspace_id at startup', () => {
      const tool = createWhoAmITool();

      expect(() =>
        createTestRoutes({
          adminMcpEnabled: true,
          auth: createAuthClient('admin-owner') as unknown as AuthInterModuleClient,
          workspaces,
          projects,
          tools: [
            {
              ...tool,
              inputSchema: {
                type: 'object',
                properties: {workspace_id: {type: 'string'}},
                additionalProperties: false,
              },
            },
          ],
        }),
      ).toThrow('Agent-access tool who_am_i already declares workspace_id');
    });
  });

  test('lists a reviewed set of tool names for a fully wired API', async () => {
    const stub = <T>() => ({}) as unknown as T;
    const app = await createTestApp({
      auth: createAuthClient('admin-operator'),
      tools: undefined,
      projects: stub<ProjectsModuleClient>(),
      definitions: stub<DefinitionsInterModuleClient>(),
      workflows: stub<WorkflowsModuleClient>(),
      annotations: stub<AnnotationsInterModuleClient>(),
      triggers: stub<TriggersInterModuleClient>(),
      logs: stub<LogsModuleClient>(),
      integrations: stub<IntegrationsModuleClient>(),
      secrets: stub<SecretsInterModuleClient>(),
      templates: stub<TemplateLoader>(),
      registry: stub<RegistryInterModuleClient>(),
      agent: stub<AgentInterModuleClient>(),
    });
    const address = await app.listen({port: 0, host: '127.0.0.1'});
    const client = new Client({name: 'test-http-client', version: '0.0.0'});
    await client.connect(
      new StreamableHTTPClientTransport(new URL('/mcp/admin', address), {
        requestInit: {headers: {authorization: 'Bearer valid-token'}},
      }) as unknown as Transport,
    );

    const listed = await client.listTools();
    await client.close();

    // A new read tool reaches administrators through this list; review it before updating.
    expect(listed.tools.map((tool) => tool.name).sort()).toMatchInlineSnapshot(`
      [
        "check_workflow",
        "diff_registry_action",
        "find_projects",
        "find_users",
        "find_workspaces",
        "get_execution_trigger_event",
        "get_integration_connection_tools",
        "get_registry_package",
        "get_run_annotations",
        "get_step_attempt",
        "get_step_log_download",
        "get_step_logs",
        "get_trigger_event",
        "get_trigger_event_facets",
        "get_workflow_authoring_context",
        "get_workflow_execution_context",
        "get_workflow_job",
        "get_workflow_run",
        "get_workflow_run_source",
        "get_workflow_template",
        "list_execution_trigger_events",
        "list_integration_connections",
        "list_projects",
        "list_registry_packages",
        "list_trigger_events",
        "list_workflow_definitions",
        "list_workflow_execution_steps",
        "list_workflow_job_executions",
        "list_workflow_run_attempts",
        "list_workflow_run_job_explanations",
        "list_workflow_run_jobs",
        "list_workflow_runs",
        "list_workflow_step_attempts",
        "list_workflow_templates",
        "list_workspace_models",
        "search_docs",
        "start_impersonation",
        "stop_impersonation",
      ]
    `);
    expect(
      listed.tools
        .filter((tool) => tool.annotations?.readOnlyHint !== true)
        .map((tool) => tool.name),
    ).toEqual(['start_impersonation', 'stop_impersonation']);
    const checkWorkflow = listed.tools.find((tool) => tool.name === 'check_workflow');
    expect(checkWorkflow?.inputSchema.required).toEqual(
      expect.arrayContaining(['workspace_id', 'project_id', 'config_path']),
    );
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
  tools?: CreateAgentAccessRoutesOptions['tools'];
  additionalTools?: CreateAgentAccessRoutesOptions['additionalTools'];
  recordCall?: CreateAgentAccessRoutesOptions['recordCall'];
  rateLimiter?: CreateAgentAccessRoutesOptions['rateLimiter'];
  additionalAdminTools?: CreateAgentAccessRoutesOptions['additionalAdminTools'];
  workspaces?: ReturnType<typeof createWorkspacesClient>;
  projects?: ReturnType<typeof createProjectsClient>;
}) {
  const app = await createTestApp({
    ...options,
    workspaces: (options.workspaces ?? workspaces) as unknown as WorkspacesInterModuleClient,
    projects: (options.projects ?? projects) as unknown as ProjectsModuleClient,
  });
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
        projects,
        // A projects client alone would make the routes require every core producer client.
        tools: [createAgentAccessFixtureTool()],
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
