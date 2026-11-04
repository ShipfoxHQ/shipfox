import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {posthogAgentToolCatalog} from '@shipfox/api-integration-posthog';
import {
  createShipfoxAgentToolsProvider,
  shipfoxAgentToolCatalog,
} from '@shipfox/api-integration-shipfox';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import type {z} from 'zod';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {IntegrationProviderError, RepositoryAuthorizerConfigurationError} from '#core/errors.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import type {SourceControlProvider} from '#core/providers/source-control.js';
import {
  RepositoryAuthorizationTargetInvalidError,
  type RepositoryAuthorizer,
} from '#core/repository-authorizer.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
import type {
  IntegrationToolCallAuditRecord,
  IntegrationToolCallCaller,
  IntegrationToolCallRecorder,
} from '#core/tool-call-audit.js';
import {SHIPFOX_BUILTIN_CONNECTION_ID} from '#core/tool-call-service.js';
import {
  type AgentToolsProviderOptions,
  agentToolsProvider,
  catalogTool,
  catalogWithRepositoryScope,
  connection,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {integrationConnectionFactory} from '#test/factories/connection.js';
import {createIntegrationsInterModulePresentation} from './inter-module.js';

const workspaceId = crypto.randomUUID();
const connectionId = crypto.randomUUID();

function createClient(
  resolveRef: (input: {ref: string}) => Promise<{ref: string; commit: string}>,
  resolveRepository: SourceControlProvider['resolveRepository'] = () => {
    throw new Error('not used');
  },
  createCheckoutCredentials: SourceControlProvider['createCheckoutCredentials'] = async () => ({
    username: 'x-access-token',
    token: 'token',
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
  }),
  repositoryAuthorizer?: RepositoryAuthorizer,
  createCheckoutSpec: NonNullable<SourceControlProvider['createCheckoutSpec']> = async (input) => ({
    repositoryUrl: 'https://gitea.local/gitea-owner/platform.git',
    ref: input.ref ?? 'main',
  }),
) {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(integrationsInterModuleContract);
  const getIntegrationConnectionById = async (id: string) => {
    await Promise.resolve();
    return id === connectionId
      ? {
          id: connectionId,
          workspaceId,
          provider: 'gitea',
          externalAccountId: 'gitea-owner',
          slug: 'gitea_owner',
          displayName: 'Gitea',
          lifecycleStatus: 'active' as const,
          repositoryAccessMode: 'selected' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : undefined;
  };

  const sourceControl = createSourceControlIntegrationService({
    registry: createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
        repositoryAuthorization: 'enforced',
        adapters: {
          source_control: {
            checkoutRepositoryAuthorization: 'enforced',
            listRepositories: vi.fn(),
            resolveRepository: vi.fn(resolveRepository),
            listFiles: vi.fn(),
            fetchFile: vi.fn(),
            resolveTriggerReference: () => null,
            resolveRef: async (input) => await resolveRef(input),
            createCheckoutSpec,
            createCheckoutCredentials,
          },
        },
      },
    ]),
    getIntegrationConnectionById,
    repositoryAuthorizer,
  });

  transport.register(
    createIntegrationsInterModulePresentation({
      registry: createIntegrationProviderRegistry([]),
      sourceControl,
      getIntegrationConnectionById,
    }),
  );
  transport.seal();
  return client;
}

describe('integrations inter-module presentation', () => {
  const input = {
    workspaceId,
    connectionId,
    externalRepositoryId: 'gitea:gitea-owner/platform',
  };

  it('exposes bounded connection details through the producer contract', async () => {
    const client = createClient(async (ref) => ({ref: ref.ref, commit: 'a'.repeat(40)}));

    await expect(client.resolveConnectionById({connectionId})).resolves.toEqual({
      id: connectionId,
      workspaceId,
      provider: 'gitea',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      lifecycleStatus: 'active',
    });
    await expect(client.resolveConnectionById({connectionId: crypto.randomUUID()})).resolves.toBe(
      null,
    );
  });

  it('round-trips credential-only checkout delivery through the transport', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async (_input) => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        generation: 'generation-2',
        renewal: {mode: 'refresh-at', refreshAt: new Date('2026-12-31T23:55:00.000Z')},
      }),
    );

    const result = await client.createCheckoutCredentials({
      workspaceId,
      connectionId,
      externalRepositoryId: 'gitea:gitea-owner/platform',
      permissions: {contents: 'read'},
      rejectedGeneration: 'generation-1',
    });

    expect(result).toEqual({
      username: 'x-access-token',
      token: 'secret',
      expiresAt: '2027-01-01T00:00:00.000Z',
      generation: 'generation-2',
      renewal: {mode: 'refresh-at', refreshAt: '2026-12-31T23:55:00.000Z'},
    });
  });

  it('rejects a provider response that echoes the rejected generation', async () => {
    const client = createClient(
      async () => ({ref: 'main', commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        generation: 'rejected-generation',
      }),
    );

    const error = await client
      .createCheckoutCredentials({
        ...input,
        permissions: {contents: 'read'},
        rejectedGeneration: 'rejected-generation',
      })
      .catch((caught: unknown) => caught);

    if (
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutCredentials,
        error,
      )
    ) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toMatchObject({reason: 'provider-rejected'});
    } else {
      throw error;
    }
  });

  it.each([
    ['repository_required', 'repository-required'],
    ['repository_not_granted', 'repository-not-granted'],
    ['repository_ambiguous', 'repository-ambiguous'],
    ['authorization_store_unavailable', 'repository-authorization-unavailable'],
  ] as const)('maps %s for both checkout methods', async (reason, code) => {
    const resolveRepositoryAuthorization = vi.fn().mockResolvedValue({
      authorized: false,
      reason,
    });
    const client = createClient(
      async () => ({ref: 'main', commit: 'a'.repeat(40)}),
      undefined,
      undefined,
      {enabled: true, resolveRepositoryAuthorization},
    );
    const details = {
      workspaceId,
      connectionId,
      target: {kind: 'external-id' as const, externalRepositoryId: input.externalRepositoryId},
    };

    const specError = await client.createCheckoutSpec(input).catch((caught: unknown) => caught);
    expect(
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutSpec,
        specError,
      ),
    ).toBe(true);
    if (
      isInterModuleKnownError(integrationsInterModuleContract.methods.createCheckoutSpec, specError)
    ) {
      expect(specError.code).toBe(code);
      expect(specError.details).toEqual(details);
    }

    const credentialsError = await client
      .createCheckoutCredentials({...input, permissions: {contents: 'read'}})
      .catch((caught: unknown) => caught);
    expect(
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutCredentials,
        credentialsError,
      ),
    ).toBe(true);
    if (
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutCredentials,
        credentialsError,
      )
    ) {
      expect(credentialsError.code).toBe(code);
      expect(credentialsError.details).toEqual(details);
    }
    expect(resolveRepositoryAuthorization).toHaveBeenNthCalledWith(1, {
      workspaceId,
      connectionId,
      mode: 'selected',
      repository: {kind: 'external-id', externalRepositoryId: input.externalRepositoryId},
      capability: 'checkout',
    });
  });

  it.each([
    [RepositoryAuthorizationTargetInvalidError, 'repository-authorization-target-invalid'],
    [RepositoryAuthorizerConfigurationError, 'repository-authorization-unavailable'],
  ] as const)('maps %s to a checkout contract error', async (ErrorType, code) => {
    const client = createClient(
      async () => ({ref: 'main', commit: 'a'.repeat(40)}),
      undefined,
      undefined,
      {
        enabled: true,
        resolveRepositoryAuthorization: vi.fn().mockRejectedValue(new ErrorType()),
      },
    );

    const error = await client.createCheckoutSpec(input).catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(integrationsInterModuleContract.methods.createCheckoutSpec, error),
    ).toBe(true);
    if (
      isInterModuleKnownError(integrationsInterModuleContract.methods.createCheckoutSpec, error)
    ) {
      expect(error.code).toBe(code);
      expect(error.details).toEqual({
        workspaceId,
        connectionId,
        target: {kind: 'external-id', externalRepositoryId: input.externalRepositoryId},
      });
    }
  });

  it('round-trips on-rejection renewal without a refresh timestamp', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        generation: 'generation-2',
        renewal: {mode: 'on-rejection'},
      }),
    );

    await expect(
      client.createCheckoutCredentials({...input, permissions: {contents: 'read'}}),
    ).resolves.toEqual({
      username: 'x-access-token',
      token: 'secret',
      expiresAt: '2027-01-01T00:00:00.000Z',
      generation: 'generation-2',
      renewal: {mode: 'on-rejection'},
    });
  });

  it('rejects an empty credential generation at the transport boundary', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        generation: '',
      }),
    );

    await expect(
      client.createCheckoutCredentials({...input, permissions: {contents: 'read'}}),
    ).rejects.toBeDefined();
  });

  it.each([
    ['after expiry', '2027-01-01T00:01:00.000Z'],
    ['already past', '2020-01-01T00:00:00.000Z'],
  ])('rejects a refresh-at renewal that is %s', async (_case, refreshAt) => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        renewal: {mode: 'refresh-at', refreshAt: new Date(refreshAt)},
      }),
    );

    await expect(
      client.createCheckoutCredentials({...input, permissions: {contents: 'read'}}),
    ).rejects.toBeDefined();
  });

  it('resolves a source ref through the transport', async () => {
    const client = createClient(async (input) => ({
      ref: input.ref,
      commit: 'a'.repeat(40),
    }));

    const result = await client.resolveSourceRef({...input, ref: 'refs/heads/main'});

    expect(result).toEqual({ref: 'refs/heads/main', commit: 'a'.repeat(40)});
  });

  it('maps a refused seed file to the invalid-seed-file known error', async () => {
    const client = createClient(async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}));
    const method = integrationsInterModuleContract.methods.createManagedRepository;

    const error = await client
      .createManagedRepository({
        workspaceId,
        projectId: crypto.randomUUID(),
        files: [{path: 'src/index.ts', content: 'x'}],
      })
      .catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(method, error)).toBe(true);
    if (isInterModuleKnownError(method, error)) {
      expect(error.code).toBe('invalid-seed-file');
      expect(error.details).toEqual({problem: 'path-not-allowed', path: 'src/index.ts'});
    }
  });

  it('maps a project that belongs to another workspace to the project-conflict known error', async () => {
    const client = createClient(async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}));
    const method = integrationsInterModuleContract.methods.createManagedRepository;
    const projectId = crypto.randomUUID();
    await client.createManagedRepository({workspaceId: crypto.randomUUID(), projectId});

    const error = await client
      .createManagedRepository({workspaceId, projectId})
      .catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(method, error)).toBe(true);
    if (isInterModuleKnownError(method, error)) {
      expect(error.code).toBe('project-conflict');
      expect(error.details).toEqual({projectId});
    }
  });

  it('maps a missing ref to the ref-not-found known error', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('ref-not-found', 'Ref not found');
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'refs/heads/missing'})
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error),
    ).toBe(true);
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('ref-not-found');
      expect(error.details).toEqual({ref: 'refs/heads/missing'});
    }
  });

  it('maps an invalid ref to the ref-invalid known error', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('ref-invalid', 'Ref is not a branch or tag name');
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'a'.repeat(40)})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('ref-invalid');
      expect(error.details).toEqual({ref: 'a'.repeat(40)});
    } else {
      throw error;
    }
  });

  it('keeps other provider failures as provider-failure known errors', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('rate-limited', 'Rate limited', 60);
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'refs/heads/main'})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toEqual({
        reason: 'rate-limited',
        retryAfterSeconds: 60,
        providerMessage: 'Rate limited',
      });
    } else {
      throw error;
    }
  });

  it('passes the provider explanation and status through, redacted and capped', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError(
        'access-denied',
        `Bearer ghs_secretvalue1234567890 was refused. ${'x'.repeat(600)}`,
        undefined,
        403,
      );
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'refs/heads/main'})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      const details = error.details as {providerMessage: string; providerStatus: number};
      expect(details.providerStatus).toBe(403);
      expect(details.providerMessage).toHaveLength(500);
      expect(details.providerMessage).not.toContain('ghs_secretvalue1234567890');
    } else {
      throw error;
    }
  });

  it('keeps ref reasons generic for methods that do not declare ref errors', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      () => {
        throw new IntegrationProviderError('ref-not-found', 'Ref not found');
      },
    );

    const error = await client.resolveSourceRepository(input).catch((caught: unknown) => caught);

    if (
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        error,
      )
    ) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toMatchObject({reason: 'ref-not-found'});
    } else {
      throw error;
    }
  });

  it('serves provider event catalogs and fixed event providers on the validation context', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);

    const sourceControl = createSourceControlIntegrationService({
      registry: createIntegrationProviderRegistry([]),
      getIntegrationConnectionById: async () => undefined,
    });
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([
          {
            provider: 'github',
            displayName: 'GitHub',
            eventCatalog: {
              provider: 'GitHub',
              families: [
                {key: 'push', title: 'Push', summary: 'Pushes.', payloadKind: 'raw-provider'},
              ],
              events: [{name: 'push', family: 'push', summary: 'A push.'}],
            },
          },
          {
            provider: 'webhook',
            displayName: 'Webhook',
            eventCatalog: {
              provider: 'Custom webhook',
              families: [
                {
                  key: 'request',
                  title: 'Requests',
                  summary: 'Requests.',
                  payloadKind: 'shipfox-normalized',
                  payloadSchema: {type: 'object'},
                },
              ],
              events: [
                {name: 'received', family: 'request', summary: 'A webhook request is accepted.'},
              ],
            },
          },
          {provider: 'gitea', displayName: 'Gitea'},
        ]),
        sourceControl,
      }),
    );
    transport.seal();

    const context = await client.getAgentToolsContext({
      workspaceId,
      defaultConnectionId: connectionId,
    });

    expect(context.eventCatalogs).toEqual([
      {provider: 'github', events: ['push']},
      {provider: 'webhook', events: ['received']},
    ]);
    expect(context.fixedEventProviders).toEqual(['webhook']);
  });
  it('adds declared built-in providers to the workspace connection snapshot', async () => {
    const builtinWorkspaceId = crypto.randomUUID();
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'shipfox',
        displayName: 'Shipfox',
        adapters: {agent_tools: agentToolsProvider([])},
      },
    ]);
    const sourceControl = createSourceControlIntegrationService({
      registry,
      getIntegrationConnectionById: async () => undefined,
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry,
        sourceControl,
        builtinConnections: [
          {provider: 'shipfox', slug: 'shipfox', id: SHIPFOX_BUILTIN_CONNECTION_ID},
        ],
      }),
    );
    transport.seal();

    const context = await client.getAgentToolsContext({
      workspaceId: builtinWorkspaceId,
      defaultConnectionId: connectionId,
    });

    expect(context.workspaceConnections).toContainEqual({
      slug: 'shipfox',
      id: SHIPFOX_BUILTIN_CONNECTION_ID,
      provider: 'shipfox',
      capabilities: ['agent_tools'],
    });
  });

  it('resolves each tool result kind on the agent tools context', async () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {
          agent_tools: agentToolsProvider([
            catalogTool({id: 'issue_read'}),
            catalogTool({id: 'download_file', result: 'file', methods: undefined}),
          ]),
        },
      },
    ]);
    const sourceControl = createSourceControlIntegrationService({
      registry,
      getIntegrationConnectionById: async () => undefined,
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(createIntegrationsInterModulePresentation({registry, sourceControl}));
    transport.seal();

    const context = await client.getAgentToolsContext({
      workspaceId,
      defaultConnectionId: connectionId,
    });

    expect(context.catalogs).toMatchObject([
      {
        provider: 'github',
        tools: [
          {id: 'issue_read', result: 'json'},
          {id: 'download_file', result: 'file'},
        ],
      },
    ]);
  });

  describe('with a managed project', () => {
    const sourceControlAdapter = {
      listRepositories: vi.fn(),
      resolveRepository: vi.fn(),
      listFiles: vi.fn(),
      fetchFile: vi.fn(),
      resolveTriggerReference: () => null,
      resolveRef: vi.fn(),
    };

    function createManagedClient() {
      const registry = createIntegrationProviderRegistry([
        {
          provider: 'github',
          displayName: 'GitHub',
          adapters: {source_control: sourceControlAdapter},
        },
        {provider: 'gitea', displayName: 'Gitea', adapters: {source_control: sourceControlAdapter}},
        {
          provider: 'managed-vcs',
          displayName: 'Shipfox',
          internal: true,
          adapters: {source_control: sourceControlAdapter},
        },
      ]);
      const sourceControl = createSourceControlIntegrationService({
        registry,
        getIntegrationConnectionById: async () => undefined,
      });
      const transport = createInMemoryInterModuleTransport();
      const client = transport.createClient(integrationsInterModuleContract);
      transport.register(createIntegrationsInterModulePresentation({registry, sourceControl}));
      transport.seal();
      return client;
    }

    async function createManagedWorkspace() {
      const managedWorkspaceId = crypto.randomUUID();
      const hidden = await integrationConnectionFactory.create({
        workspaceId: managedWorkspaceId,
        provider: 'managed-vcs',
        externalAccountId: managedWorkspaceId,
        slug: 'shipfox-managed',
      });
      return {workspaceId: managedWorkspaceId, hidden};
    }

    it("defaults to the workspace's only source-control connection", async () => {
      const client = createManagedClient();
      const {workspaceId: managedWorkspaceId, hidden} = await createManagedWorkspace();
      const github = await integrationConnectionFactory.create({
        workspaceId: managedWorkspaceId,
        provider: 'github',
        externalAccountId: 'acme',
        slug: 'github',
      });

      await expect(
        client.resolveSourceControlConnection({workspaceId: managedWorkspaceId}),
      ).resolves.toEqual({id: github.id, provider: 'github', slug: 'github'});
      const context = await client.getAgentToolsContext({
        workspaceId: managedWorkspaceId,
        defaultConnectionId: hidden.id,
      });
      expect(context.defaultConnection).toEqual({
        id: github.id,
        slug: 'github',
        provider: 'github',
      });
    });

    it('has no default when the workspace has several source-control connections', async () => {
      const client = createManagedClient();
      const {workspaceId: managedWorkspaceId, hidden} = await createManagedWorkspace();
      await integrationConnectionFactory.create({
        workspaceId: managedWorkspaceId,
        provider: 'github',
        externalAccountId: 'acme',
        slug: 'github',
      });
      await integrationConnectionFactory.create({
        workspaceId: managedWorkspaceId,
        provider: 'gitea',
        externalAccountId: 'acme',
        slug: 'gitea',
      });

      await expect(
        client.resolveSourceControlConnection({workspaceId: managedWorkspaceId}),
      ).resolves.toBeNull();
      const context = await client.getAgentToolsContext({
        workspaceId: managedWorkspaceId,
        defaultConnectionId: hidden.id,
      });
      expect(context.defaultConnection).toBeNull();
    });
  });

  it('lists workspace connections and returns a workspace-scoped provider catalog', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    const catalog = [
      catalogTool({
        id: 'issue_read',
        description: 'Read issues from GitHub.',
        methods: [
          {
            id: 'get',
            description: 'Get one issue.',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: [],
          },
        ],
      }),
      catalogTool({
        id: 'download_file',
        description: 'Download a file from GitHub.',
        result: 'file',
        methods: undefined,
      }),
    ];
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        eventCatalog: {
          provider: 'github',
          families: [
            {key: 'issues', title: 'Issues', summary: 'Issues.', payloadKind: 'raw-provider'},
          ],
          events: [{name: 'issues', family: 'issues', summary: 'An issue changed.'}],
        },
        connectionExternalUrl: async (connection) =>
          `https://github.com/${connection.externalAccountId}`,
        adapters: {agent_tools: agentToolsProvider(catalog)},
      },
    ]);
    const sourceControl = createSourceControlIntegrationService({
      registry,
      getIntegrationConnectionById: async () => undefined,
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(createIntegrationsInterModulePresentation({registry, sourceControl}));
    transport.seal();

    const first = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      slug: 'github_alpha',
      externalAccountId: 'alpha',
    });
    const second = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      slug: 'github_beta',
      externalAccountId: 'beta',
    });
    await integrationConnectionFactory.create({
      workspaceId: otherWorkspaceId,
      provider: 'github',
      slug: 'github_other',
      externalAccountId: 'other',
    });

    const firstPage = await client.listConnectionsByWorkspace({
      workspaceId,
      capability: 'agent_tools',
      limit: 1,
    });
    const secondPage = await client.listConnectionsByWorkspace({
      workspaceId,
      capability: 'agent_tools',
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.connections).toEqual([
      {
        id: first.id,
        slug: 'github_alpha',
        provider: 'github',
        displayName: first.displayName,
        lifecycleStatus: 'active',
        capabilities: ['agent_tools'],
        externalUrl: 'https://github.com/alpha',
        createdAt: first.createdAt.toISOString(),
        updatedAt: first.updatedAt.toISOString(),
      },
    ]);
    expect(firstPage.nextCursor).toEqual({slug: 'github_alpha', id: first.id});
    expect(secondPage.connections.map(({id}) => id)).toEqual([second.id]);
    expect(secondPage.nextCursor).toBeNull();

    await expect(
      client.getConnectionToolCatalog({workspaceId, connectionId: first.id}),
    ).resolves.toEqual({
      connection: {
        id: first.id,
        slug: 'github_alpha',
        provider: 'github',
        displayName: first.displayName,
        lifecycleStatus: 'active',
        capabilities: ['agent_tools'],
      },
      tools: [
        {
          id: 'issue_read',
          description: 'Read issues from GitHub.',
          sensitivity: 'read',
          sensitive: false,
          result: 'json',
          methods: [
            {
              id: 'get',
              description: 'Get one issue.',
              sensitivity: 'read',
              sensitive: false,
            },
          ],
        },
        {
          id: 'download_file',
          description: 'Download a file from GitHub.',
          sensitivity: 'read',
          sensitive: false,
          result: 'file',
        },
      ],
      events: ['issues'],
    });
    await expect(
      client.getConnectionToolCatalog({workspaceId: otherWorkspaceId, connectionId: first.id}),
    ).resolves.toBeNull();
  });

  it.each([
    'not-a-url',
    'javascript:alert(1)',
  ])('omits invalid external URL %s while preserving the connection page cursor', async (invalidExternalUrl) => {
    const testWorkspaceId = crypto.randomUUID();
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        connectionExternalUrl: async () => invalidExternalUrl,
      },
    ]);
    const sourceControl = createSourceControlIntegrationService({
      registry,
      getIntegrationConnectionById: async () => undefined,
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(createIntegrationsInterModulePresentation({registry, sourceControl}));
    transport.seal();

    const first = await integrationConnectionFactory.create({
      workspaceId: testWorkspaceId,
      provider: 'github',
      slug: 'github_invalid',
      externalAccountId: 'invalid',
    });
    const second = await integrationConnectionFactory.create({
      workspaceId: testWorkspaceId,
      provider: 'github',
      slug: 'github_next',
      externalAccountId: 'next',
    });

    const firstPage = await client.listConnectionsByWorkspace({
      workspaceId: testWorkspaceId,
      limit: 1,
    });
    const secondPage = await client.listConnectionsByWorkspace({
      workspaceId: testWorkspaceId,
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.connections).toEqual([
      {
        id: first.id,
        slug: 'github_invalid',
        provider: 'github',
        displayName: first.displayName,
        lifecycleStatus: 'active',
        capabilities: [],
        createdAt: first.createdAt.toISOString(),
        updatedAt: first.updatedAt.toISOString(),
      },
    ]);
    expect(firstPage.nextCursor).toEqual({slug: first.slug, id: first.id});
    expect(secondPage.connections.map(({id}) => id)).toEqual([second.id]);
    expect(secondPage.nextCursor).toBeNull();
  });
});

describe('integrations inter-module callTool', () => {
  it('resolves a PostHog tool id for a tool step through the gateway', async () => {
    const entry = posthogAgentToolCatalog.find((tool) => tool.id === 'execute-sql');
    if (!entry) throw new Error('PostHog execute-sql tool is missing from the catalog');
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    const posthogConnection = connection({
      id: connectionId,
      workspaceId,
      provider: 'posthog',
      slug: 'posthog_analytics',
    });
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([
          {
            provider: 'posthog',
            displayName: 'PostHog',
            adapters: {
              agent_tools: agentToolsProvider([entry], {
                result: {
                  content: [{type: 'text', text: 'ok'}],
                  structuredContent: {tool_id: 'execute-sql'},
                },
              }),
            },
          },
        ]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => posthogConnection,
      }),
    );
    transport.seal();

    const result = await client.callTool({
      workspaceId,
      connectionId,
      tool: {
        id: entry.id,
        provider: 'posthog',
        sensitivity: entry.sensitivity,
        sensitive: entry.sensitive,
        requiredScope: [],
        inputSchema: entry.inputSchema,
      },
      arguments: {query: 'SELECT 1'},
      caller: {
        kind: 'tool_step',
        projectId: 'project-1',
        runId: 'run-1',
        jobExecutionId: 'execution-1',
        stepId: 'step-1',
        stepAttempt: 1,
        callIndex: 1,
      },
    });

    expect(result).toMatchObject({
      outcome: 'success',
      result: expect.objectContaining({tool_id: 'execute-sql'}),
    });
  });

  const toolCallInput: z.input<typeof integrationsInterModuleContract.methods.callTool.input> = {
    workspaceId,
    connectionId,
    tool: {
      id: 'issue_read',
      provider: 'github',
      method: 'get',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [],
      inputSchema: catalogTool().inputSchema,
      outputSchema: catalogTool().outputSchema,
      methods: [
        {
          id: 'get',
          token: 'issue_read.get',
          sensitivity: 'read',
          sensitive: false,
          requiredScope: [],
        },
      ],
    },
    arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
    caller: {
      kind: 'tool_step',
      projectId: 'project-1',
      runId: 'run-1',
      jobExecutionId: 'execution-1',
      stepId: 'step-1',
      stepAttempt: 2,
      callIndex: 3,
    },
  };

  function createToolCallClient(
    providerOptions: AgentToolsProviderOptions = {},
    resolveConnection: (id: string) => Promise<IntegrationConnection | undefined> = async () =>
      connection({id: connectionId, workspaceId}),
    createRecorder:
      | ((caller: IntegrationToolCallCaller) => IntegrationToolCallRecorder)
      | undefined = undefined,
    catalog = [catalogTool()],
    options: {
      repositoryAuthorizer?: RepositoryAuthorizer | undefined;
    } = {},
  ) {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: registryWithAgentTools(catalog, providerOptions),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: resolveConnection,
        repositoryAuthorizer: options.repositoryAuthorizer,
        ...(createRecorder === undefined
          ? {}
          : {createIntegrationToolCallRecorder: createRecorder}),
      }),
    );
    transport.seal();
    return client;
  }

  it('calls the frozen tool through a single-tool provider session', async () => {
    const onCall = vi.fn();
    const client = createToolCallClient({onCall});

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'success',
      result: {
        status: 'dispatched',
        provider: 'github',
        connection_id: connectionId,
        tool_id: 'issue_read',
        method: 'get',
      },
      content: [{type: 'text', text: 'dispatched'}],
    });
    expect(onCall).toHaveBeenCalledWith({
      toolId: 'issue_read',
      arguments: toolCallInput.arguments,
    });
  });

  it('denies a repository before deterministic dispatch and audits the run project', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogWithRepositoryScope(() => ({
      kind: 'declared-targets',
      repositories: [{owner: 'shipfox', name: 'platform'}],
    }));
    const resolveRepositoryAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'repository_not_granted' as const,
    }));
    const recorder = vi.fn();
    const client = createToolCallClient(
      {repositoryAuthorization: 'enforced', onOpenSession},
      undefined,
      () => recorder,
      [entry],
      {
        repositoryAuthorizer: {
          enabled: true,
          resolveRepositoryAuthorization,
        },
      },
    );

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'error',
      code: 'repository-not-granted',
      message: 'Repository is not authorized for this integration connection',
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledTimes(1);
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        outcome: 'tool-error',
        errorCode: 'repository-not-granted',
        repositories: [{owner: 'shipfox', name: 'platform'}],
        classification: 'declared-targets',
        repositoryAccess: 'selected',
        decision: 'denied',
        denialReason: 'repository_not_granted',
        runProjectId: 'project-1',
      }),
    );
  });

  it('accepts the agent caller without tool-step identity fields', async () => {
    const client = createToolCallClient();

    const result = await client.callTool({...toolCallInput, caller: {kind: 'agent'}});

    expect(result.outcome).toBe('success');
  });

  it('refuses a conversation caller on a provider that offers no conversation catalog', async () => {
    const onCall = vi.fn();
    const client = createToolCallClient({onCall});

    const result = await client.callTool({
      ...toolCallInput,
      caller: {
        kind: 'conversation',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        agentKey: 'shippy',
        turnId: 'turn-1',
        callItemId: 'item-1',
      },
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unknown integration tool: issue_read',
    });
    expect(onCall).not.toHaveBeenCalled();
  });

  it('serves a conversation caller the full catalog when the agent file granted the tool', async () => {
    const onCall = vi.fn();
    const client = createToolCallClient({onCall});

    const result = await client.callTool({
      ...toolCallInput,
      caller: {
        kind: 'conversation',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        agentKey: 'shippy',
        callItemId: 'item-1',
        grantedByAgent: true,
      },
    });

    expect(result.outcome).toBe('success');
    expect(onCall).toHaveBeenCalledOnce();
  });

  it('classifies repository targets from the conversation catalog', async () => {
    const onCall = vi.fn();
    const resolveRepositoryAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'repository_not_granted' as const,
    }));
    const client = createToolCallClient(
      {
        repositoryAuthorization: 'enforced',
        onCall,
        conversationCatalog: [
          catalogWithRepositoryScope(() => ({
            kind: 'declared-targets',
            repositories: [{owner: 'shipfox', name: 'platform'}],
          })),
        ],
      },
      undefined,
      undefined,
      [catalogTool()],
      {repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization}},
    );

    const result = await client.callTool({
      ...toolCallInput,
      caller: {
        kind: 'conversation',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        agentKey: 'shippy',
        turnId: 'turn-1',
        callItemId: 'item-1',
      },
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'repository-not-granted',
      message: 'Repository is not authorized for this integration connection',
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledOnce();
    expect(onCall).not.toHaveBeenCalled();
  });

  it('rejects an executed method outside the frozen catalog allowlist as an invalid-request outcome', async () => {
    const onCall = vi.fn();
    const client = createToolCallClient({onCall});

    const result = await client.callTool({
      ...toolCallInput,
      arguments: {...toolCallInput.arguments, method: 'get_comments'},
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unauthorized integration tool method: get_comments',
    });
    expect(onCall).not.toHaveBeenCalled();
  });

  it('rejects a method-family call without a string method argument', async () => {
    const client = createToolCallClient();
    const {method: _omitted, ...argumentsWithoutMethod} = toolCallInput.arguments;

    const result = await client.callTool({...toolCallInput, arguments: argumentsWithoutMethod});

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Method-family tools require a string method argument',
    });
  });

  it('rejects a tool id that is no longer in the live catalog', async () => {
    const client = createToolCallClient();

    const result = await client.callTool({
      ...toolCallInput,
      tool: {...toolCallInput.tool, id: 'removed_tool'},
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unknown integration tool: removed_tool',
    });
  });

  it('rejects a frozen method that is no longer in the live catalog', async () => {
    const onCall = vi.fn();
    const liveCatalogTool = catalogTool();
    const liveMethod = liveCatalogTool.methods?.find((method) => method.id === 'get_comments');
    if (!liveMethod) throw new Error('Missing live fixture method');
    const client = createToolCallClient({onCall}, undefined, undefined, [
      catalogTool({methods: [liveMethod]}),
    ]);

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unauthorized integration tool method: get',
    });
    expect(onCall).not.toHaveBeenCalled();
  });

  const connectionFailureCases: ReadonlyArray<
    [string, (id: string) => Promise<IntegrationConnection | undefined>]
  > = [
    ['connection-not-found', async () => undefined],
    [
      'connection-workspace-mismatch',
      async () => connection({id: connectionId, workspaceId: 'other-workspace'}),
    ],
    [
      'connection-inactive',
      async () => connection({id: connectionId, workspaceId, lifecycleStatus: 'disabled'}),
    ],
    [
      'connection-provider-changed',
      async () => connection({id: connectionId, workspaceId, provider: 'slack'}),
    ],
  ];

  it.each(
    connectionFailureCases,
  )('maps a %s connection state to its known error', async (code, resolveConnection) => {
    const client = createToolCallClient({}, resolveConnection);

    const error = await client.callTool(toolCallInput).catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      expect(error.code).toBe(code);
      expect(error.details).toEqual({connectionId});
    }
  });

  it('maps a missing agent-tools capability to its known error', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([{provider: 'github', displayName: 'GitHub'}]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
      }),
    );
    transport.seal();

    const error = await client.callTool(toolCallInput).catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      expect(error.code).toBe('capability-unavailable');
      expect(error.details).toEqual({provider: 'github', capability: 'agent_tools'});
    }
  });

  it('maps a missing provider to the provider-unavailable known error', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
      }),
    );
    transport.seal();

    const error = await client.callTool(toolCallInput).catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      expect(error.code).toBe('provider-unavailable');
      expect(error.details).toEqual({provider: 'github'});
    }
  });

  it('cancels a call whose transport deadline elapses while the provider call is in flight', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([
          {
            provider: 'github',
            displayName: 'GitHub',
            adapters: {
              agent_tools: {
                catalog: () => [catalogTool()],
                selectionCatalog: () => ({selectors: []}),
                openSession: () =>
                  Promise.resolve({
                    // A call that never settles: only the deadline can end it.
                    call: () => new Promise(() => undefined),
                    close: () => Promise.resolve(),
                  }),
              },
            },
          },
        ]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
      }),
    );
    transport.seal();

    await expect(
      client.callTool(toolCallInput, {signal: AbortSignal.timeout(20)}),
    ).rejects.toMatchObject({name: 'TimeoutError'});
  });

  it('maps a deadline abort during the provider call to a provider-timeout outcome', async () => {
    const transport = createInMemoryInterModuleTransport();
    const presentation = createIntegrationsInterModulePresentation({
      registry: createIntegrationProviderRegistry([
        {
          provider: 'github',
          displayName: 'GitHub',
          adapters: {
            agent_tools: {
              catalog: () => [catalogTool()],
              selectionCatalog: () => ({selectors: []}),
              openSession: () =>
                Promise.resolve({
                  // A call that never settles: only the deadline can end it.
                  call: () => new Promise(() => undefined),
                  close: () => Promise.resolve(),
                }),
            },
          },
        },
      ]),
      sourceControl: createSourceControlIntegrationService({
        registry: createIntegrationProviderRegistry([]),
        getIntegrationConnectionById: async () => undefined,
      }),
      getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
    });
    transport.register(presentation);
    transport.seal();

    const result = await presentation.handlers.callTool(toolCallInput, {
      signal: AbortSignal.timeout(20),
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'provider-timeout',
      message: 'Integration provider timed out',
    });
  });

  it('keeps a completed call success when the audit recorder throws', async () => {
    const client = createToolCallClient(
      {},
      async () => connection({id: connectionId, workspaceId}),
      () => () => {
        throw new Error('audit backend unavailable');
      },
    );

    const result = await client.callTool(toolCallInput);

    expect(result.outcome).toBe('success');
  });

  it('propagates a provider error with retry and status details', async () => {
    const client = createToolCallClient({
      callError: new IntegrationProviderError('rate-limited', 'Try again later', 30, 429),
    });

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'error',
      code: 'rate-limited',
      message: 'Try again later',
      retryAfterSeconds: 30,
      status: 429,
    });
  });

  it('falls back to a null structured result for text-only provider results', async () => {
    const client = createToolCallClient({
      result: {content: [{type: 'text', text: 'dispatched'}]},
    });

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'success',
      result: null,
      content: [{type: 'text', text: 'dispatched'}],
    });
  });

  it('records the executed method, outcome, and caller on the audit recorder for a successful call', async () => {
    const recorder = vi.fn();
    const createdCallers: IntegrationToolCallCaller[] = [];
    const client = createToolCallClient(
      {},
      async () => connection({id: connectionId, workspaceId}),
      (caller) => {
        createdCallers.push(caller);
        return recorder;
      },
    );

    await client.callTool(toolCallInput);

    expect(createdCallers[0]).toMatchObject({caller: 'tool_step', workspaceId, runId: 'run-1'});
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizedTool: expect.objectContaining({
          tool: expect.objectContaining({id: 'issue_read'}),
        }),
        method: 'get',
        outcome: 'success',
        errorCode: 'none',
      }),
    );
  });

  describe('conversation caller', () => {
    const conversationProjectId = crypto.randomUUID();
    const conversationCaller = {
      kind: 'conversation' as const,
      projectId: conversationProjectId,
      conversationId: 'conversation-1',
      agentKey: 'shippy',
      turnId: 'turn-1',
      callItemId: 'item-1',
      actorUserId: 'user-1',
    };

    function createConversationClient(runProjectId: string) {
      const listAnnotationsForRunAttempt = vi
        .fn()
        .mockResolvedValue({annotations: [], nextCursor: null});
      const provider = createShipfoxAgentToolsProvider({
        agent: {claimConversationRunStart: vi.fn(), registerConversationRun: vi.fn()},
        clientBaseUrl: 'https://app.example.test',
        annotations: {listAnnotationsForRunAttempt},
        definitions: {
          getDefinitionByConfigPath: vi.fn(),
          getDefinitionForWorkflowRun: vi.fn(),
          listDefinitionsByProject: vi.fn(),
        },
        docs: {search: vi.fn()},
        projects: {
          listProjectsByWorkspace: vi.fn(),
          requireProjectForWorkspace: vi.fn(),
        },
        logs: {readStepLogTail: vi.fn()},
        triggers: {fireManualTrigger: vi.fn()},
        workflows: {
          hasRunForIdempotencyKey: vi.fn(),
          listWorkflowRuns: vi.fn(),
          listWorkflowRunJobs: vi.fn(),
          getWorkflowJobDetail: vi.fn(),
          getLatestRunAttempt: vi.fn().mockResolvedValue({attempt: 1}),
          getWorkflowRunOverview: vi.fn().mockResolvedValue({run: {project_id: runProjectId}}),
          getWorkflowStepAttemptDetail: vi.fn(),
          getWorkflowJobExecutionContext: vi.fn(),
          listFailedStepAttempts: vi.fn(),
          listWorkflowRunJobExplanations: vi.fn(),
          listWorkflowStepAttempts: vi.fn(),
        },
      });
      const transport = createInMemoryInterModuleTransport();
      const client = transport.createClient(integrationsInterModuleContract);
      const audits: {
        caller: IntegrationToolCallCaller;
        record: IntegrationToolCallAuditRecord;
      }[] = [];
      transport.register(
        createIntegrationsInterModulePresentation({
          registry: createIntegrationProviderRegistry([
            {provider: 'shipfox', displayName: 'Shipfox', adapters: {agent_tools: provider}},
            {
              provider: 'github',
              displayName: 'GitHub',
              adapters: {agent_tools: agentToolsProvider()},
            },
          ]),
          sourceControl: createSourceControlIntegrationService({
            registry: createIntegrationProviderRegistry([]),
            getIntegrationConnectionById: async () => undefined,
          }),
          getIntegrationConnectionById: async () => undefined,
          createIntegrationToolCallRecorder: (caller) => (record) => {
            audits.push({caller, record});
          },
        }),
      );
      transport.seal();
      return {client, listAnnotationsForRunAttempt, audits};
    }

    async function conversationTool(
      client: ReturnType<typeof createConversationClient>['client'],
      id: string,
    ) {
      const {tools} = await client.listConversationTools({});
      const tool = tools.find((candidate) => candidate.id === id);
      if (tool === undefined) throw new Error(`Conversation tool ${id} is not offered`);
      return tool;
    }

    it('offers only the tools of providers with a conversation catalog', async () => {
      const {client} = createConversationClient(conversationProjectId);

      const {tools} = await client.listConversationTools({});

      expect(tools.map((tool) => tool.provider)).toEqual(tools.map(() => 'shipfox'));
      expect(tools.map((tool) => tool.id)).not.toContain('list_projects');
      expect(tools.find((tool) => tool.id === 'start_workflow_run')?.inputSchema).toMatchObject({
        properties: {workflow: expect.any(Object), inputs: expect.any(Object)},
      });
      expect(
        Object.keys(
          (
            tools.find((tool) => tool.id === 'start_workflow_run')?.inputSchema as {
              properties: Record<string, unknown>;
            }
          ).properties,
        ),
      ).toEqual(['workflow', 'inputs']);
      expect(tools.find((tool) => tool.id === 'list_workflow_runs')).toMatchObject({
        description: expect.any(String),
        sensitivity: 'read',
      });
      expect(
        tools.find((tool) => tool.id === 'list_workflow_runs')?.inputSchema,
      ).not.toHaveProperty('properties.project_id');
    });

    it('calls an offered tool with no lease and audits the conversation', async () => {
      const {client, listAnnotationsForRunAttempt, audits} =
        createConversationClient(conversationProjectId);

      const result = await client.callTool({
        workspaceId,
        connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
        tool: await conversationTool(client, 'get_run_annotations'),
        arguments: {run_id: crypto.randomUUID()},
        caller: conversationCaller,
      });

      expect(result.outcome).toBe('success');
      expect(listAnnotationsForRunAttempt).toHaveBeenCalledOnce();
      expect(audits).toEqual([
        {
          caller: {
            caller: 'conversation',
            workspaceId,
            projectId: conversationProjectId,
            conversationId: 'conversation-1',
            agentKey: 'shippy',
            turnId: 'turn-1',
            callItemId: 'item-1',
            actorUserId: 'user-1',
          },
          record: expect.objectContaining({outcome: 'success', errorCode: 'none'}),
        },
      ]);
    });

    it('answers not-found for a run from another project', async () => {
      const {client, listAnnotationsForRunAttempt} = createConversationClient(crypto.randomUUID());

      const result = await client.callTool({
        workspaceId,
        connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
        tool: await conversationTool(client, 'get_run_annotations'),
        arguments: {run_id: crypto.randomUUID()},
        caller: conversationCaller,
      });

      expect(result).toMatchObject({outcome: 'error', code: 'not-found'});
      expect(listAnnotationsForRunAttempt).not.toHaveBeenCalled();
    });

    it('rejects an injected project_id', async () => {
      const {client} = createConversationClient(conversationProjectId);

      const result = await client.callTool({
        workspaceId,
        connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
        tool: await conversationTool(client, 'list_workflow_runs'),
        arguments: {project_id: crypto.randomUUID()},
        caller: conversationCaller,
      });

      expect(result).toMatchObject({outcome: 'error', code: 'invalid-request'});
    });

    it('refuses a tool outside the conversation catalog even when the caller names it', async () => {
      const {client} = createConversationClient(conversationProjectId);

      const result = await client.callTool({
        workspaceId,
        connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
        tool: {...(await conversationTool(client, 'list_workflow_runs')), id: 'list_projects'},
        arguments: {},
        caller: conversationCaller,
      });

      expect(result).toEqual({
        outcome: 'error',
        code: 'invalid-request',
        message: 'Unknown integration tool: list_projects',
      });
    });
  });

  it('dispatches start_workflow_run through callTool with the parent run', async () => {
    const trigger = vi.fn().mockResolvedValue({
      id: crypto.randomUUID(),
      name: 'Child workflow',
      deduplicated: false,
    });
    const provider = createShipfoxAgentToolsProvider({
      agent: {claimConversationRunStart: vi.fn(), registerConversationRun: vi.fn()},
      clientBaseUrl: 'https://app.example.test',
      annotations: {
        listAnnotationsForRunAttempt: vi.fn(),
      },
      definitions: {
        getDefinitionByConfigPath: vi.fn().mockResolvedValue({
          definitionId: crypto.randomUUID(),
          workflowId: crypto.randomUUID(),
          name: 'Child workflow',
        }),
        getDefinitionForWorkflowRun: vi.fn(),
        listDefinitionsByProject: vi.fn(),
      },
      docs: {search: vi.fn()},
      projects: {
        listProjectsByWorkspace: vi.fn(),
        requireProjectForWorkspace: vi.fn(),
      },
      logs: {readStepLogTail: vi.fn()},
      triggers: {fireManualTrigger: trigger},
      workflows: {
        hasRunForIdempotencyKey: vi.fn(),
        listWorkflowRuns: vi.fn(),
        listWorkflowRunJobs: vi.fn(),
        getWorkflowJobDetail: vi.fn(),
        getLatestRunAttempt: vi.fn(),
        getWorkflowRunOverview: vi.fn().mockResolvedValue({run: {number: 7}}),
        getWorkflowStepAttemptDetail: vi.fn(),
        getWorkflowJobExecutionContext: vi.fn(),
        listFailedStepAttempts: vi.fn(),
        listWorkflowRunJobExplanations: vi.fn(),
        listWorkflowStepAttempts: vi.fn(),
      },
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    const tool = shipfoxAgentToolCatalog[0];
    const parentRunId = crypto.randomUUID();
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([
          {provider: 'shipfox', displayName: 'Shipfox', adapters: {agent_tools: provider}},
        ]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => undefined,
        builtinConnections: [
          {provider: 'shipfox', slug: 'shipfox', id: SHIPFOX_BUILTIN_CONNECTION_ID},
        ],
      }),
    );
    transport.seal();

    const result = await client.callTool({
      workspaceId,
      connectionId: SHIPFOX_BUILTIN_CONNECTION_ID,
      tool: {
        id: tool.id,
        provider: 'shipfox',
        sensitivity: tool.sensitivity,
        sensitive: tool.sensitive,
        requiredScope: [],
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      },
      arguments: {workflow: 'child.yml'},
      caller: {
        kind: 'tool_step',
        projectId: crypto.randomUUID(),
        runId: parentRunId,
        jobExecutionId: crypto.randomUUID(),
        stepId: 'start-child',
        stepAttempt: 1,
        callIndex: 3,
      },
    });

    expect(result).toMatchObject({outcome: 'success', result: {run_number: 7}});
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({parentRun: {runId: parentRunId}}),
    );
  });

  it('records provider error details on the audit recorder', async () => {
    const recorder = vi.fn();
    const client = createToolCallClient(
      {callError: new IntegrationProviderError('rate-limited', 'Try again later', 30, 429)},
      async () => connection({id: connectionId, workspaceId}),
      () => recorder,
    );

    await client.callTool(toolCallInput);

    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        outcome: 'tool-error',
        errorCode: 'rate-limited',
        providerStatus: 429,
      }),
    );
  });

  it('records an invalid-request audit line for a rejected executed method', async () => {
    const recorder = vi.fn();
    const client = createToolCallClient(
      {},
      async () => connection({id: connectionId, workspaceId}),
      () => recorder,
    );

    await client.callTool({
      ...toolCallInput,
      arguments: {...toolCallInput.arguments, method: 'get_labels'},
    });

    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'invalid',
        outcome: 'invalid-request',
        errorCode: 'invalid-request',
      }),
    );
  });
});

describe('integrations template conformance', () => {
  it('checks a composed template against the registered providers and built-ins', async () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {
          agent_tools: {
            ...agentToolsProvider(),
            selectionCatalog: () => ({
              selectors: [
                {token: 'issue_read', kind: 'family', sensitivity: 'read', sensitive: false},
              ],
            }),
          },
        },
      },
    ]);
    const sourceControl = createSourceControlIntegrationService({
      registry,
      getIntegrationConnectionById: async () => undefined,
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry,
        sourceControl,
        builtinConnections: [
          {slug: 'shipfox', id: SHIPFOX_BUILTIN_CONNECTION_ID, provider: 'shipfox'},
        ],
      }),
    );
    transport.seal();
    const workflow = [
      'jobs:',
      '  work:',
      '    steps:',
      '      - key: read',
      '        tool: issue_read',
      '        connection: github_source # bind:source',
      '      - key: comment',
      '        tool: add_issue_comment',
      '        connection: github_source # bind:source',
      '      - key: run',
      '        tool: get_workflow_run',
      '        connection: shipfox',
    ].join('\n');

    await expect(
      client.checkTemplateConformance({workflow, bindings: {source: 'github'}}),
    ).resolves.toEqual({
      issues: [
        'github_source (github): unknown tool add_issue_comment',
        'connection shipfox uses provider shipfox, which is not available',
      ],
    });
  });

  describe('resolveAgentTools', () => {
    const projectId = crypto.randomUUID();

    function createResolver(params: {workspaceId: string; sourceConnectionId?: string}) {
      const registry = createIntegrationProviderRegistry([
        {
          provider: 'github',
          displayName: 'GitHub',
          adapters: {
            agent_tools: agentToolsProvider([
              catalogTool({id: 'issue_read'}),
              catalogTool({id: 'issue_write', sensitivity: 'write', methods: undefined}),
            ]),
          },
        },
      ]);
      const sourceControl = createSourceControlIntegrationService({
        registry,
        getIntegrationConnectionById: async () => undefined,
      });
      const transport = createInMemoryInterModuleTransport();
      const client = transport.createClient(integrationsInterModuleContract);
      transport.register(
        createIntegrationsInterModulePresentation({
          registry,
          sourceControl,
          projects: {
            getProjectById: async () => {
              await Promise.resolve();
              return {
                project: {
                  id: projectId,
                  workspaceId: params.workspaceId,
                  sourceConnectionId: params.sourceConnectionId ?? connectionId,
                  sourceExternalRepositoryId: 'acme/api',
                },
              };
            },
          } as never,
          getIntegrationConnectionById: async (id) => {
            await Promise.resolve();
            return id === params.sourceConnectionId
              ? await integrationConnectionFactory.build({
                  id,
                  workspaceId: params.workspaceId,
                  provider: 'github',
                  slug: 'github_alpha',
                })
              : undefined;
          },
        }),
      );
      transport.seal();
      return client;
    }

    it('grants a read tool of the project default connection', async () => {
      const resolverWorkspaceId = crypto.randomUUID();
      const github = await integrationConnectionFactory.create({
        workspaceId: resolverWorkspaceId,
        provider: 'github',
        slug: 'github_alpha',
      });
      const client = createResolver({
        workspaceId: resolverWorkspaceId,
        sourceConnectionId: github.id,
      });

      const {integrations} = await client.resolveAgentTools({
        workspaceId: resolverWorkspaceId,
        projectId,
        integrations: [{include: ['issue_read.get'], allowWrite: false}],
      });

      expect(integrations).toMatchObject([
        {
          connectionId: github.id,
          connectionSlug: 'github_alpha',
          provider: 'github',
          tools: [{id: 'issue_read', sensitivity: 'read', methods: [{token: 'issue_read.get'}]}],
        },
      ]);
    });

    it('refuses a write tool without allowWrite as a known error that names the entry', async () => {
      const resolverWorkspaceId = crypto.randomUUID();
      const github = await integrationConnectionFactory.create({
        workspaceId: resolverWorkspaceId,
        provider: 'github',
        slug: 'github_alpha',
      });
      const client = createResolver({
        workspaceId: resolverWorkspaceId,
        sourceConnectionId: github.id,
      });

      const error = await client
        .resolveAgentTools({
          workspaceId: resolverWorkspaceId,
          projectId,
          integrations: [
            {include: ['issue_read'], allowWrite: false},
            {include: ['issue_write'], allowWrite: false},
          ],
        })
        .catch((caught: unknown) => caught);

      expect(
        isInterModuleKnownError(integrationsInterModuleContract.methods.resolveAgentTools, error),
      ).toBe(true);
      expect(error).toMatchObject({
        code: 'selection-invalid',
        details: {
          integrationIndex: 1,
          reason: 'write-not-allowed',
          connection: 'github_alpha',
          tool: 'issue_write',
        },
      });
    });

    it('treats a project of another workspace as missing', async () => {
      const client = createResolver({workspaceId: crypto.randomUUID()});

      await expect(
        client.resolveAgentTools({
          workspaceId: crypto.randomUUID(),
          projectId,
          integrations: [{include: ['issue_read'], allowWrite: false}],
        }),
      ).rejects.toMatchObject({code: 'project-not-found', details: {projectId}});
    });
  });

  it('answers the agent tools context without a default connection', async () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {agent_tools: agentToolsProvider([catalogTool({id: 'issue_read'})])},
      },
    ]);
    const sourceControl = createSourceControlIntegrationService({
      registry,
      getIntegrationConnectionById: async () => undefined,
    });
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(createIntegrationsInterModulePresentation({registry, sourceControl}));
    transport.seal();

    const context = await client.getAgentToolsContext({workspaceId});

    expect(context.defaultConnection).toBeNull();
    expect(context.catalogs).toMatchObject([{provider: 'github'}]);
  });
});
