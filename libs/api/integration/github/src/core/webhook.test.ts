import {randomUUID} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  PublishIntegrationEventReceivedFn,
  PublishSourcePushFn,
  PublishSourceRepositoryUpdatedFn,
  RecordDeliveryOnlyFn,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import {eq} from 'drizzle-orm';
import type {GithubApiClient} from '#api/client.js';
import {db} from '#db/db.js';
import {githubInstallations} from '#db/schema/installations.js';
import {githubUnlinkedInstallations} from '#db/schema/unlinked-installations.js';
import {githubInstallationFactory, githubPushPayload} from '#test/index.js';
import {GithubIntegrationProviderError} from './errors.js';
import {handleGithubEvent} from './webhook.js';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'github',
    externalAccountId: '123',
    slug: 'github_shipfox',
    displayName: 'GitHub shipfox',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function deps(
  options: {
    connection?: IntegrationConnection | undefined;
    publishIntegrationEventReceivedResult?: {published: boolean};
    publishSourceRepositoryUpdatedResult?: {published: boolean};
    publishSourcePushResult?: {published: boolean};
  } = {},
) {
  return {
    publishIntegrationEventReceived: vi.fn<PublishIntegrationEventReceivedFn>(() =>
      Promise.resolve(options.publishIntegrationEventReceivedResult ?? {published: true}),
    ),
    publishSourceRepositoryUpdated: vi.fn<PublishSourceRepositoryUpdatedFn>(() =>
      Promise.resolve(options.publishSourceRepositoryUpdatedResult ?? {published: true}),
    ),
    publishSourcePush: vi.fn<PublishSourcePushFn>(() =>
      Promise.resolve(options.publishSourcePushResult ?? {published: true}),
    ),
    recordDeliveryOnly: vi.fn<RecordDeliveryOnlyFn>(() => Promise.resolve({claimed: true})),
    getIntegrationConnectionById: vi.fn<GetIntegrationConnectionByIdFn>(() =>
      Promise.resolve(options.connection ?? fakeConnection()),
    ),
    updateConnectionLifecycleStatus: vi.fn<UpdateIntegrationConnectionLifecycleStatusFn>(() =>
      Promise.resolve(undefined),
    ),
    github: {getInstallation: vi.fn<GithubApiClient['getInstallation']>()},
  };
}

function firstPublishSourcePushCall(publishSourcePush: {
  mock: {calls: Array<Parameters<PublishSourcePushFn>>};
}): Parameters<PublishSourcePushFn>[0] {
  const [call] = publishSourcePush.mock.calls;
  if (!call) {
    throw new Error('Expected publishSourcePush to be called');
  }

  return call[0];
}

function firstPublishIntegrationEventReceivedCall(publishIntegrationEventReceived: {
  mock: {calls: Array<Parameters<PublishIntegrationEventReceivedFn>>};
}): Parameters<PublishIntegrationEventReceivedFn>[0] {
  const [call] = publishIntegrationEventReceived.mock.calls;
  if (!call) {
    throw new Error('Expected publishIntegrationEventReceived to be called');
  }

  return call[0];
}

function firstRecordDeliveryOnlyCall(recordDeliveryOnly: {
  mock: {calls: Array<Parameters<RecordDeliveryOnlyFn>>};
}): Parameters<RecordDeliveryOnlyFn>[0] {
  const [call] = recordDeliveryOnly.mock.calls;
  if (!call) {
    throw new Error('Expected recordDeliveryOnly to be called');
  }

  return call[0];
}

async function seedInstallation(installationId: number, connectionId?: string): Promise<void> {
  await githubInstallationFactory.create({
    installationId: String(installationId),
    ...(connectionId !== undefined && {connectionId}),
  });
}

describe('handleGithubEvent', () => {
  beforeEach(async () => {
    await db().delete(githubUnlinkedInstallations);
    await db().delete(githubInstallations);
  });

  it('publishes a mapped event for a valid push from a known installation', async () => {
    const installationId = 7777;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = githubPushPayload({
      installationId,
      repositoryId: 42,
      ref: 'refs/heads/main',
      defaultBranch: 'main',
      sha: 'abc123',
    });

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'push',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.getIntegrationConnectionById).toHaveBeenCalledWith(
      connection.id,
      expect.objectContaining({tx: expect.anything()}),
    );
    expect(firstPublishSourcePushCall(handlers.publishSourcePush)).toMatchObject({
      provider: 'github',
      source: connection.slug,
      deliveryId,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      rawPayload: payload,
      push: {
        externalRepositoryId: 'github:42',
        ref: 'main',
        headCommitSha: 'abc123',
        isDefaultBranch: true,
      },
    });
  });

  it('returns duplicate when a push delivery was already published', async () => {
    const installationId = 7778;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection, publishSourcePushResult: {published: false}});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      payload: githubPushPayload({
        installationId,
        repositoryId: 42,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'abc123',
      }),
      ...handlers,
    });

    expect(result.outcome).toBe('duplicate');
    expect(handlers.publishSourcePush).toHaveBeenCalledTimes(1);
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('publishes a generic envelope for a branch deletion', async () => {
    const installationId = 7779;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = githubPushPayload({
      installationId,
      repositoryId: 42,
      ref: 'refs/heads/main',
      defaultBranch: 'main',
      sha: '0000000000000000000000000000000000000000',
    });

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'push',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published-push-envelope-only');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(
      firstPublishIntegrationEventReceivedCall(handlers.publishIntegrationEventReceived),
    ).toMatchObject({
      event: {
        source: connection.slug,
        event: 'push',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload,
      },
    });
  });

  it('returns duplicate-push-envelope-only when a branch deletion was already published', async () => {
    const installationId = 7780;
    await seedInstallation(installationId);
    const handlers = deps({publishIntegrationEventReceivedResult: {published: false}});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      payload: githubPushPayload({
        installationId,
        repositoryId: 42,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: '0000000000000000000000000000000000000000',
      }),
      ...handlers,
    });

    expect(result.outcome).toBe('duplicate-push-envelope-only');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  it('publishes a generic envelope when a push payload fails schema validation', async () => {
    const installationId = 7786;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = {
      installation: {id: installationId},
      ref: 'refs/heads/main',
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'push',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(
      firstPublishIntegrationEventReceivedCall(handlers.publishIntegrationEventReceived),
    ).toMatchObject({
      event: {
        source: connection.slug,
        event: 'push',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload,
      },
    });
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('publishes a generic envelope for a non-push event with an action', async () => {
    const installationId = 7781;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = {
      action: 'opened',
      installation: {id: installationId},
      repository: {id: 42, full_name: 'shipfox/platform'},
      pull_request: {
        number: 17,
        head: {repo: {id: 42, full_name: 'shipfox/platform'}},
        base: {repo: {id: 42, full_name: 'shipfox/platform'}},
      },
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'pull_request',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(
      firstPublishIntegrationEventReceivedCall(handlers.publishIntegrationEventReceived),
    ).toMatchObject({
      event: {
        source: connection.slug,
        event: 'pull_request.opened',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        deliveryId,
        payload,
      },
    });
  });

  it('drops a cross-repository pull request before generic event publication', async () => {
    const handlers = deps();
    const deliveryId = randomUUID();
    const payload = {
      action: 'opened',
      installation: {id: 7787},
      repository: {id: 42, full_name: 'shipfox/platform'},
      pull_request: {
        head: {repo: {id: 84, full_name: 'contributor/platform'}},
        base: {repo: {id: 42, full_name: 'shipfox/platform'}},
      },
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'pull_request',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('fork-pull-request');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(firstRecordDeliveryOnlyCall(handlers.recordDeliveryOnly)).toMatchObject({
      provider: 'github',
      deliveryId,
    });
  });

  it('records and drops pull request deliveries whose head repository is unresolved', async () => {
    const handlers = deps();
    const deliveryId = randomUUID();
    const payload = {
      action: 'synchronize',
      installation: {id: 7789},
      repository: {id: 42, full_name: 'shipfox/platform'},
      pull_request: {
        head: {repo: null},
        base: {repo: {id: 42, full_name: 'shipfox/platform'}},
      },
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'pull_request',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('fork-pull-request');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(firstRecordDeliveryOnlyCall(handlers.recordDeliveryOnly)).toMatchObject({
      provider: 'github',
      deliveryId,
    });
  });

  it('publishes pull request deliveries whose head and base repositories match', async () => {
    const installationId = 7788;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const payload = {
      action: 'opened',
      installation: {id: installationId},
      repository: {id: 42, full_name: 'shipfox/platform'},
      pull_request: {
        head: {repo: {id: 42, full_name: 'shipfox/platform'}},
        base: {repo: {id: 42, full_name: 'shipfox/platform'}},
      },
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'pull_request',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  it('publishes a typed repository update for a repository rename', async () => {
    const installationId = 7784;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = {
      action: 'renamed',
      installation: {id: installationId},
      repository: {
        id: 42,
        name: 'platform-renamed',
        owner: {login: 'acme'},
        default_branch: 'trunk',
      },
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'repository',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.publishSourceRepositoryUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'repository.renamed',
        rawPayload: payload,
        repositories: [
          {
            externalRepositoryId: 'github:42',
            owner: 'acme',
            name: 'platform-renamed',
            defaultBranch: 'trunk',
          },
        ],
      }),
    );
  });

  it('publishes typed updates only for added installation repositories', async () => {
    const installationId = 7785;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = {
      action: 'added',
      installation: {id: installationId},
      repositories_added: [
        {id: 42, name: 'platform', owner: {login: 'acme'}, default_branch: 'main'},
      ],
      repositories_removed: [
        {id: 43, name: 'runner', owner: {login: 'acme'}, default_branch: 'trunk'},
      ],
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'installation_repositories',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.publishSourceRepositoryUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'installation_repositories.added',
        repositories: [
          {
            externalRepositoryId: 'github:42',
            owner: 'acme',
            name: 'platform',
            defaultBranch: 'main',
          },
        ],
      }),
    );
  });

  it('publishes removed installation repositories only in the generic envelope', async () => {
    const installationId = 7786;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = {
      action: 'removed',
      installation: {id: installationId},
      repositories_added: [],
      repositories_removed: [
        {id: 43, name: 'runner', owner: {login: 'acme'}, default_branch: 'trunk'},
      ],
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'installation_repositories',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(handlers.publishSourceRepositoryUpdated).not.toHaveBeenCalled();
    expect(
      firstPublishIntegrationEventReceivedCall(handlers.publishIntegrationEventReceived),
    ).toMatchObject({
      event: {
        event: 'installation_repositories.removed',
        payload,
      },
    });
  });

  it('returns the cached installation token cleanup handle when the installation is deleted', async () => {
    const installationId = 7791;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'installation',
      payload: {action: 'deleted', installation: {id: installationId}},
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(result.installationTokenCleanup).toEqual({
      workspaceId: connection.workspaceId,
      installationId,
    });
  });

  it('deletes a stale unlinked record when a linked installation is deleted', async () => {
    const installationId = 7790;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const firstSeenAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db()
      .insert(githubUnlinkedInstallations)
      .values({
        installationId: String(installationId),
        accountLogin: 'opsmill',
        accountType: 'Organization',
        repositorySelection: 'selected',
        lastAction: 'created',
        firstSeenAt,
        lastSeenAt: firstSeenAt,
      });
    const handlers = deps({connection});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: 'delivery-linked-deleted',
      event: 'installation',
      payload: {action: 'deleted', installation: {id: installationId}},
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    await expect(
      db()
        .select()
        .from(githubUnlinkedInstallations)
        .where(eq(githubUnlinkedInstallations.installationId, String(installationId))),
    ).resolves.toHaveLength(0);
  });

  it('keeps the cleanup handle for duplicate lifecycle deliveries', async () => {
    const installationId = 7792;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection, publishIntegrationEventReceivedResult: {published: false}});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'installation',
      payload: {action: 'suspend', installation: {id: installationId}},
      ...handlers,
    });

    expect(result.outcome).toBe('duplicate-envelope');
    expect(result.installationTokenCleanup).toEqual({
      workspaceId: connection.workspaceId,
      installationId,
    });
  });

  it('handles lifecycle deliveries whose requester is null', async () => {
    const installationId = 7797;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'installation',
      payload: {
        action: 'deleted',
        installation: {id: installationId, account: {id: 1, login: 'acme', type: 'Organization'}},
        sender: {login: 'octocat'},
        requester: null,
      },
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(result.installationTokenCleanup).toEqual({
      workspaceId: connection.workspaceId,
      installationId,
    });
  });

  it('returns the cleanup handle and publishes the approval event', async () => {
    const installationId = 7794;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const payload = {
      action: 'new_permissions_accepted',
      installation: {id: installationId},
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'installation',
      payload,
      ...handlers,
    });

    expect(result).toEqual({
      outcome: 'published-envelope',
      installationTokenCleanup: {
        workspaceId: connection.workspaceId,
        installationId,
      },
    });
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          event: 'installation.new_permissions_accepted',
          payload,
        }),
      }),
    );
  });

  it('returns the cleanup handle for a deletion delivered after the connection is disabled', async () => {
    const installationId = 7793;
    const connection = fakeConnection({lifecycleStatus: 'disabled'});
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'installation',
      payload: {action: 'deleted', installation: {id: installationId}},
      ...handlers,
    });

    expect(result).toEqual({
      outcome: 'installation-lifecycle',
      installationTokenCleanup: {
        workspaceId: connection.workspaceId,
        installationId,
      },
    });
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('returns the approval cleanup handle after the connection is disabled', async () => {
    const installationId = 7795;
    const connection = fakeConnection({lifecycleStatus: 'disabled'});
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'installation',
      payload: {action: 'new_permissions_accepted', installation: {id: installationId}},
      ...handlers,
    });

    expect(result).toEqual({
      outcome: 'inactive-connection',
      installationTokenCleanup: {
        workspaceId: connection.workspaceId,
        installationId,
      },
    });
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['installation', 'created'],
    ['repository', 'deleted'],
  ] as const)('does not request cleanup for %s.%s deliveries', async (event, action) => {
    const installationId = 7796;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event,
      payload: {action, installation: {id: installationId}},
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(result.installationTokenCleanup).toBeUndefined();
  });

  it('publishes a bare resource envelope when action is malformed', async () => {
    const installationId = 7782;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = {
      action: null,
      installation: {id: installationId},
      repository: {id: 42, full_name: 'shipfox/platform'},
      pull_request: {
        number: 17,
        head: {repo: {id: 42, full_name: 'shipfox/platform'}},
        base: {repo: {id: 42, full_name: 'shipfox/platform'}},
      },
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'pull_request',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(
      firstPublishIntegrationEventReceivedCall(handlers.publishIntegrationEventReceived),
    ).toMatchObject({
      event: {
        source: connection.slug,
        event: 'pull_request',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload,
      },
    });
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it('publishes GitHub repository fork events as generic envelopes', async () => {
    const installationId = 7783;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    const deliveryId = randomUUID();
    const payload = {
      installation: {id: installationId},
      repository: {id: 42, full_name: 'shipfox/platform'},
      forkee: {id: 84, full_name: 'contributor/platform'},
    };

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'fork',
      payload,
      ...handlers,
    });

    expect(result.outcome).toBe('published-envelope');
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.publishSourceRepositoryUpdated).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(
      firstPublishIntegrationEventReceivedCall(handlers.publishIntegrationEventReceived),
    ).toMatchObject({
      event: {
        source: connection.slug,
        event: 'fork',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        provider: 'github',
        deliveryId,
        payload,
      },
    });
  });

  it('returns duplicate-envelope when a generic envelope delivery was already published', async () => {
    const installationId = 7783;
    await seedInstallation(installationId);
    const handlers = deps({publishIntegrationEventReceivedResult: {published: false}});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'fork',
      payload: {installation: {id: installationId}},
      ...handlers,
    });

    expect(result.outcome).toBe('duplicate-envelope');
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  it('records the delivery only when there is no installation id', async () => {
    const handlers = deps();
    const deliveryId = randomUUID();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'push',
      payload: {ref: 'refs/heads/main'},
      ...handlers,
    });

    expect(result.outcome).toBe('no-installation-id');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(firstRecordDeliveryOnlyCall(handlers.recordDeliveryOnly)).toMatchObject({
      provider: 'github',
      deliveryId,
    });
  });

  it('logs full identity details at warn for an unknown installation event', async () => {
    const infoSpy = vi.spyOn(logger(), 'info');
    const warnSpy = vi.spyOn(logger(), 'warn');
    const handlers = deps();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: 'delivery-full',
      event: 'installation',
      payload: {
        action: 'created',
        installation: {
          id: 999999,
          account: {id: 1, login: 'opsmill', type: 'Organization'},
          repository_selection: 'selected',
        },
        sender: {login: 'octocat'},
        requester: {login: 'member'},
      },
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-installation');
    expect(infoSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'installation'}),
      expect.any(String),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'installation',
        action: 'created',
        account: {id: 1, login: 'opsmill', type: 'Organization'},
        sender: {login: 'octocat'},
        requester: {login: 'member'},
      }),
      'github webhook: unknown installation, dropping',
    );
  });

  it.each([
    'created',
    'new_permissions_accepted',
    'unsuspend',
  ] as const)('records unknown installation.%s details for detection', async (action) => {
    const handlers = deps();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: `delivery-${action}`,
      event: 'installation',
      payload: {
        action,
        installation: {
          id: 999996,
          account: {id: 1, login: 'opsmill', type: 'Organization'},
          repository_selection: 'selected',
        },
        sender: {login: 'octocat'},
        requester: null,
      },
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-installation');
    await expect(
      db()
        .select()
        .from(githubUnlinkedInstallations)
        .where(eq(githubUnlinkedInstallations.installationId, '999996')),
    ).resolves.toEqual([
      expect.objectContaining({
        installationId: '999996',
        accountLogin: 'opsmill',
        accountType: 'Organization',
        repositorySelection: 'selected',
        senderLogin: 'octocat',
        requesterLogin: null,
        lastAction: action,
      }),
    ]);
  });

  it('deletes an unlinked record for an unknown installation uninstall', async () => {
    await db().insert(githubUnlinkedInstallations).values({
      installationId: '999995',
      accountLogin: 'opsmill',
      accountType: 'Organization',
      repositorySelection: 'selected',
      lastAction: 'created',
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });
    const handlers = deps();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: 'delivery-deleted',
      event: 'installation',
      payload: {action: 'deleted', installation: {id: 999995}},
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-installation');
    await expect(
      db()
        .select()
        .from(githubUnlinkedInstallations)
        .where(eq(githubUnlinkedInstallations.installationId, '999995')),
    ).resolves.toHaveLength(0);
  });

  it('logs minimal non-installation payloads at info for an unknown installation', async () => {
    const infoSpy = vi.spyOn(logger(), 'info');
    const warnSpy = vi.spyOn(logger(), 'warn');
    const handlers = deps();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: 'delivery-minimal',
      event: 'push',
      payload: {installation: {id: 999998}},
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-installation');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'push',
        account: undefined,
        sender: undefined,
        requester: undefined,
      }),
      'github webhook: unknown installation, dropping',
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'push'}),
      expect.any(String),
    );
  });

  it('logs installation repository events at info for an unknown installation', async () => {
    const infoSpy = vi.spyOn(logger(), 'info');
    const warnSpy = vi.spyOn(logger(), 'warn');
    const handlers = deps();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: 'delivery-installation-repositories',
      event: 'installation_repositories',
      payload: {installation: {id: 999997}},
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-installation');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({event: 'installation_repositories'}),
      'github webhook: unknown installation, dropping',
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'installation_repositories'}),
      expect.any(String),
    );
  });

  it('records the delivery only for an unknown installation', async () => {
    const handlers = deps();
    const deliveryId = randomUUID();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId,
      event: 'push',
      payload: githubPushPayload({
        installationId: 999999,
        repositoryId: 42,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'abc123',
      }),
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-installation');
    expect(handlers.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(firstRecordDeliveryOnlyCall(handlers.recordDeliveryOnly)).toMatchObject({
      provider: 'github',
      deliveryId,
    });
  });

  it('records the delivery only when the installation has no connection', async () => {
    const installationId = 7784;
    await seedInstallation(installationId);
    const handlers = deps();
    handlers.getIntegrationConnectionById.mockResolvedValue(undefined);

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      payload: githubPushPayload({
        installationId,
        repositoryId: 42,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'abc123',
      }),
      ...handlers,
    });

    expect(result.outcome).toBe('missing-connection');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it.each([
    'disabled',
    'error',
  ] as const)('records the delivery only when the connection is %s', async (lifecycleStatus) => {
    const installationId = 7785;
    const connection = fakeConnection({lifecycleStatus});
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: randomUUID(),
      event: 'push',
      payload: githubPushPayload({
        installationId,
        repositoryId: 42,
        ref: 'refs/heads/main',
        defaultBranch: 'main',
        sha: 'abc123',
      }),
      ...handlers,
    });

    expect(result.outcome).toBe('inactive-connection');
    expect(handlers.publishSourcePush).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });
});

describe('handleGithubEvent installation lifecycle', () => {
  beforeEach(async () => {
    await db().delete(githubInstallations);
  });

  function installationDetails(suspendedAt: Date | null) {
    return {
      id: 1,
      account: {id: 1, login: 'shipfox', type: 'Organization'},
      repositorySelection: 'all',
      suspendedAt,
      htmlUrl: 'https://github.com/settings/installations/1',
      raw: {},
    };
  }

  async function readInstallation(installationId: number) {
    const [row] = await db()
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, String(installationId)));
    if (!row) throw new Error('Expected installation row');
    return row;
  }

  function lifecycleEvent(
    action: 'deleted' | 'suspend' | 'unsuspend',
    installationId: number,
    handlers: ReturnType<typeof deps>,
    deliveryId = randomUUID(),
  ) {
    return db().transaction((tx) =>
      handleGithubEvent({
        tx,
        deliveryId,
        event: 'installation',
        payload: {action, installation: {id: installationId}},
        ...handlers,
      }),
    );
  }

  it('records a deletion on the installation and moves the connection to error', async () => {
    const installationId = 8101;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});

    const result = await lifecycleEvent('deleted', installationId, handlers);

    expect(result).toEqual({
      outcome: 'published-envelope',
      installationTokenCleanup: {workspaceId: connection.workspaceId, installationId},
    });
    expect((await readInstallation(installationId)).deletedAt).toBeInstanceOf(Date);
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(handlers.updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connection.id, lifecycleStatus: 'error', expectedStatuses: ['active']},
      expect.anything(),
    );
  });

  it('keeps the first deletion time and skips the write for a redelivered deletion', async () => {
    const installationId = 8102;
    const connection = fakeConnection();
    const deletedAt = new Date('2026-10-18T10:00:00.000Z');
    await githubInstallationFactory.create({
      installationId: String(installationId),
      connectionId: connection.id,
      deletedAt,
    });
    const handlers = deps({connection, publishIntegrationEventReceivedResult: {published: false}});

    const result = await lifecycleEvent('deleted', installationId, handlers);

    expect(result.outcome).toBe('duplicate-envelope');
    expect(result.installationTokenCleanup).toEqual({
      workspaceId: connection.workspaceId,
      installationId,
    });
    expect((await readInstallation(installationId)).deletedAt).toEqual(deletedAt);
    expect(handlers.updateConnectionLifecycleStatus).not.toHaveBeenCalled();
  });

  it('keeps the first deletion time when a new delivery arrives for a deleted installation', async () => {
    const installationId = 8103;
    const connection = fakeConnection({lifecycleStatus: 'error'});
    const deletedAt = new Date('2026-10-18T10:00:00.000Z');
    await githubInstallationFactory.create({
      installationId: String(installationId),
      connectionId: connection.id,
      deletedAt,
    });
    const handlers = deps({connection});

    await lifecycleEvent('deleted', installationId, handlers);

    expect((await readInstallation(installationId)).deletedAt).toEqual(deletedAt);
  });

  it('writes GitHub state on suspend and moves an active connection to error', async () => {
    const installationId = 8104;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const suspendedAt = new Date('2026-10-20T09:00:00.000Z');
    const handlers = deps({connection});
    handlers.github.getInstallation.mockResolvedValue(installationDetails(suspendedAt));

    const result = await lifecycleEvent('suspend', installationId, handlers);

    expect(handlers.github.getInstallation).toHaveBeenCalledWith(installationId);
    expect((await readInstallation(installationId)).suspendedAt).toEqual(suspendedAt);
    expect(handlers.updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connection.id, lifecycleStatus: 'error', expectedStatuses: ['active']},
      expect.anything(),
    );
    expect(result.installationTokenCleanup).toEqual({
      workspaceId: connection.workspaceId,
      installationId,
    });
  });

  it('reactivates an errored connection on unsuspend and still publishes the unsuspend event', async () => {
    const installationId = 8105;
    const connection = fakeConnection({lifecycleStatus: 'error'});
    await githubInstallationFactory.create({
      installationId: String(installationId),
      connectionId: connection.id,
      suspendedAt: new Date('2026-10-20T09:00:00.000Z'),
    });
    const handlers = deps({connection});
    handlers.github.getInstallation.mockResolvedValue(installationDetails(null));

    const result = await lifecycleEvent('unsuspend', installationId, handlers);

    expect(result).toEqual({outcome: 'published-envelope'});
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({event: 'installation.unsuspend'}),
      }),
    );
    expect((await readInstallation(installationId)).suspendedAt).toBeNull();
    expect(handlers.updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connection.id, lifecycleStatus: 'active', expectedStatuses: ['error']},
      expect.anything(),
    );
  });

  it('follows the GitHub read instead of the event action', async () => {
    const installationId = 8106;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    handlers.github.getInstallation.mockResolvedValue(installationDetails(null));

    await lifecycleEvent('suspend', installationId, handlers);

    expect((await readInstallation(installationId)).suspendedAt).toBeNull();
    expect(handlers.updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connection.id, lifecycleStatus: 'active', expectedStatuses: ['error']},
      expect.anything(),
    );
  });

  it('does not let a stale suspend commit after a later unsuspend', async () => {
    const installationId = 8107;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const suspendedAt = new Date('2026-10-20T09:00:00.000Z');
    const readOrder: string[] = [];

    let releaseSuspendRead: () => void = () => undefined;
    let markSuspendReadStarted: () => void = () => undefined;
    const suspendReadStarted = new Promise<void>((resolve) => {
      markSuspendReadStarted = resolve;
    });
    const handlersA = deps({connection});
    handlersA.github.getInstallation.mockImplementation(async () => {
      readOrder.push('a-read');
      markSuspendReadStarted();
      await new Promise<void>((resolve) => {
        releaseSuspendRead = resolve;
      });
      return installationDetails(suspendedAt);
    });
    const handlersB = deps({connection});
    handlersB.github.getInstallation.mockImplementation(() => {
      readOrder.push('b-read');
      return Promise.resolve(installationDetails(null));
    });

    const handlerA = lifecycleEvent('suspend', installationId, handlersA);
    await suspendReadStarted;
    const handlerB = lifecycleEvent('unsuspend', installationId, handlersB);
    // B must be parked on the row lock while A still holds it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handlersB.github.getInstallation).not.toHaveBeenCalled();
    releaseSuspendRead();
    await Promise.all([handlerA, handlerB]);

    // B read only after A released the lock, so B's state is the last commit.
    expect(readOrder).toEqual(['a-read', 'b-read']);
    expect((await readInstallation(installationId)).suspendedAt).toBeNull();
  });

  it('applies the deletion when the suspend read returns 404', async () => {
    const installationId = 8108;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    handlers.github.getInstallation.mockRejectedValue(
      new GithubIntegrationProviderError('installation-not-found', 'not found', undefined, 404),
    );

    await lifecycleEvent('suspend', installationId, handlers);

    expect((await readInstallation(installationId)).deletedAt).toBeInstanceOf(Date);
    expect(handlers.updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      {id: connection.id, lifecycleStatus: 'error', expectedStatuses: ['active']},
      expect.anything(),
    );
  });

  it('retries a transient GitHub read failure and then applies the state', async () => {
    const installationId = 8109;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const suspendedAt = new Date('2026-10-20T09:00:00.000Z');
    const handlers = deps({connection});
    handlers.github.getInstallation
      .mockRejectedValueOnce(
        new GithubIntegrationProviderError('provider-unavailable', 'down', undefined, 503),
      )
      .mockRejectedValueOnce(new GithubIntegrationProviderError('timeout', 'slow'))
      .mockResolvedValue(installationDetails(suspendedAt));

    await lifecycleEvent('suspend', installationId, handlers);

    expect(handlers.github.getInstallation).toHaveBeenCalledTimes(3);
    expect((await readInstallation(installationId)).suspendedAt).toEqual(suspendedAt);
  });

  it('writes nothing and throws when the GitHub read keeps failing', async () => {
    const installationId = 8114;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    handlers.github.getInstallation.mockRejectedValue(
      new GithubIntegrationProviderError('provider-unavailable', 'down', undefined, 503),
    );

    await expect(lifecycleEvent('suspend', installationId, handlers)).rejects.toThrow('down');

    expect(handlers.github.getInstallation).toHaveBeenCalledTimes(3);
    const row = await readInstallation(installationId);
    expect(row.suspendedAt).toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(handlers.updateConnectionLifecycleStatus).not.toHaveBeenCalled();
  });

  it('does not retry a GitHub read failure that cannot clear', async () => {
    const installationId = 8115;
    const connection = fakeConnection();
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    handlers.github.getInstallation.mockRejectedValue(
      new GithubIntegrationProviderError('access-denied', 'denied', undefined, 401),
    );

    await expect(lifecycleEvent('suspend', installationId, handlers)).rejects.toThrow('denied');

    expect(handlers.github.getInstallation).toHaveBeenCalledTimes(1);
  });

  it.each([
    'suspend',
    'unsuspend',
  ] as const)('ignores %s for a deleted installation', async (action) => {
    const installationId = action === 'suspend' ? 8110 : 8111;
    const connection = fakeConnection({lifecycleStatus: 'error'});
    const deletedAt = new Date('2026-10-18T10:00:00.000Z');
    await githubInstallationFactory.create({
      installationId: String(installationId),
      connectionId: connection.id,
      deletedAt,
    });
    const handlers = deps({connection});

    await lifecycleEvent(action, installationId, handlers);

    expect(handlers.github.getInstallation).not.toHaveBeenCalled();
    expect(handlers.updateConnectionLifecycleStatus).not.toHaveBeenCalled();
    const row = await readInstallation(installationId);
    expect(row.suspendedAt).toBeNull();
    expect(row.deletedAt).toEqual(deletedAt);
  });

  it.each([
    ['deleted', ['active']],
    ['suspend', ['active']],
  ] as const)('only lets %s change a connection that is %j so a disabled one stays disabled', async (action, expectedStatuses) => {
    const installationId = action === 'deleted' ? 8112 : 8113;
    const connection = fakeConnection({lifecycleStatus: 'disabled'});
    await seedInstallation(installationId, connection.id);
    const handlers = deps({connection});
    handlers.github.getInstallation.mockResolvedValue(
      installationDetails(new Date('2026-10-20T09:00:00.000Z')),
    );

    await lifecycleEvent(action, installationId, handlers);

    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
    expect(handlers.updateConnectionLifecycleStatus).toHaveBeenCalledWith(
      expect.objectContaining({id: connection.id, expectedStatuses}),
      expect.anything(),
    );
  });
});
