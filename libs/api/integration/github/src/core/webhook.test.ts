import {randomUUID} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  PublishIntegrationEventReceivedFn,
  PublishSourcePushFn,
  PublishSourceRepositoryUpdatedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {githubInstallations} from '#db/schema/installations.js';
import {githubUnlinkedInstallations} from '#db/schema/unlinked-installations.js';
import {upsertGithubUnlinkedInstallation} from '#db/unlinked-installations.js';
import {githubInstallationFactory, githubPushPayload} from '#test/index.js';
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
    recordDeliveryOnly: vi.fn<RecordDeliveryOnlyFn>(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn<GetIntegrationConnectionByIdFn>(() =>
      Promise.resolve(options.connection ?? fakeConnection()),
    ),
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
    await db().delete(githubInstallations);
    await db().delete(githubUnlinkedInstallations);
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
        installation: {id: installationId, account: {login: 'acme', type: 'Organization'}},
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
      outcome: 'inactive-connection',
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

  it.each([
    'created',
    'new_permissions_accepted',
    'unsuspend',
  ] as const)('records an unknown lifecycle installation for orphan detection (%s)', async (action) => {
    const installationId = 999996;
    const handlers = deps();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: `delivery-${action}`,
      event: 'installation',
      payload: {
        action,
        installation: {
          id: installationId,
          account: {login: 'opsmill', type: 'Organization'},
          repository_selection: 'selected',
        },
        sender: {login: 'octocat'},
        requester: {login: 'member'},
      },
      ...handlers,
    });

    const rows = await db()
      .select()
      .from(githubUnlinkedInstallations)
      .where(eq(githubUnlinkedInstallations.installationId, String(installationId)));

    expect(result.outcome).toBe('unknown-installation');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      installationId: String(installationId),
      accountLogin: 'opsmill',
      accountType: 'Organization',
      repositorySelection: 'selected',
      senderLogin: 'octocat',
      requesterLogin: 'member',
      lastAction: action,
    });
  });

  it('deletes an unknown installation record on uninstall', async () => {
    const installationId = 999995;
    await upsertGithubUnlinkedInstallation({
      installationId: String(installationId),
      accountLogin: 'opsmill',
      accountType: 'Organization',
      repositorySelection: 'all',
      senderLogin: 'octocat',
      requesterLogin: null,
      lastAction: 'created',
    });
    const handlers = deps();

    const result = await handleGithubEvent({
      tx: db(),
      deliveryId: 'delivery-deleted',
      event: 'installation',
      payload: {action: 'deleted', installation: {id: installationId}},
      ...handlers,
    });

    const rows = await db()
      .select()
      .from(githubUnlinkedInstallations)
      .where(eq(githubUnlinkedInstallations.installationId, String(installationId)));

    expect(result.outcome).toBe('unknown-installation');
    expect(rows).toHaveLength(0);
  });

  it('does not record non-lifecycle events for an unknown installation', async () => {
    const handlers = deps();

    await handleGithubEvent({
      tx: db(),
      deliveryId: 'delivery-push',
      event: 'push',
      payload: {
        installation: {
          id: 999994,
          account: {login: 'opsmill', type: 'Organization'},
          repository_selection: 'all',
        },
      },
      ...handlers,
    });

    await expect(db().select().from(githubUnlinkedInstallations)).resolves.toHaveLength(0);
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
          account: {login: 'opsmill', type: 'Organization'},
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
        account: {login: 'opsmill', type: 'Organization'},
        sender: {login: 'octocat'},
        requester: {login: 'member'},
      }),
      'github webhook: unknown installation, dropping',
    );
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
