import {
  azureDevOpsConnection,
  COMMIT_SHA,
  PROJECT_ID,
  pullRequestNotification,
  pushNotification,
  REPOSITORY_ID,
} from '#test/index.js';
import {handleAzureDevOpsWebhook} from './webhook.js';

const EXTERNAL_ID = `azure-devops:${PROJECT_ID}/${REPOSITORY_ID}`;

function setup(notification: {id: string; eventType: string; resource: Record<string, unknown>}) {
  const publishSourcePush = vi.fn(() => Promise.resolve({published: true}));
  const publishIntegrationEventReceived = vi.fn(() => Promise.resolve({published: true}));
  const recordDeliveryOnly = vi.fn(() => Promise.resolve({claimed: true}));
  const connection = azureDevOpsConnection();
  const params = {
    tx: {},
    connection,
    envelope: notification,
    rawPayload: notification,
    receivedAt: '2026-11-04T12:00:00.000Z',
    publishSourcePush,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
  };
  return {
    params,
    connection,
    publishSourcePush,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
  };
}

describe('handleAzureDevOpsWebhook', () => {
  it('publishes a push to the default branch as a source push with the stable repository id', async () => {
    const notification = pushNotification();
    const {params, connection, publishSourcePush} = setup(notification);

    const outcome = await handleAzureDevOpsWebhook(params);

    expect(outcome).toBe('published');
    expect(publishSourcePush).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'azure-devops',
        source: connection.slug,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        deliveryId: notification.id,
        resource: {kind: 'repository', externalId: EXTERNAL_ID, lookupName: 'fabrikam/platform'},
        push: {
          externalRepositoryId: EXTERNAL_ID,
          ref: 'main',
          headCommitSha: COMMIT_SHA,
          defaultBranch: 'main',
          isDefaultBranch: true,
        },
      }),
    );
  });

  it('marks a push to another branch as not the default branch', async () => {
    const {params, publishSourcePush} = setup(
      pushNotification({
        refUpdates: [{name: 'refs/heads/feat/x', newObjectId: COMMIT_SHA}],
      }),
    );

    await handleAzureDevOpsWebhook(params);

    expect(publishSourcePush).toHaveBeenCalledWith(
      expect.objectContaining({
        push: expect.objectContaining({ref: 'feat/x', isDefaultBranch: false}),
      }),
    );
  });

  it('drops a branch deletion without publishing', async () => {
    const {params, publishSourcePush, publishIntegrationEventReceived} = setup(
      pushNotification({refUpdates: [{name: 'refs/heads/old', newObjectId: '0'.repeat(40)}]}),
    );

    expect(await handleAzureDevOpsWebhook(params)).toBe('deleted');
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
  });

  it('reports a duplicate delivery', async () => {
    const {params, publishSourcePush} = setup(pushNotification());
    publishSourcePush.mockResolvedValue({published: false});

    expect(await handleAzureDevOpsWebhook(params)).toBe('duplicate');
  });

  it('publishes a pull request event with its repository as the event resource', async () => {
    const notification = pullRequestNotification('git.pullrequest.updated');
    const {params, publishIntegrationEventReceived, publishSourcePush} = setup(notification);

    expect(await handleAzureDevOpsWebhook(params)).toBe('published');
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          provider: 'azure-devops',
          event: 'git.pullrequest.updated',
          deliveryId: notification.id,
          resource: {kind: 'repository', externalId: EXTERNAL_ID, lookupName: 'fabrikam/platform'},
          payload: notification,
        }),
      }),
    );
  });

  it('takes the repository of a comment event from the commented pull request', async () => {
    const notification = {
      id: crypto.randomUUID(),
      eventType: 'ms.vss-code.git-pullrequest-comment-event',
      resource: {
        comment: {content: 'please fix'},
        pullRequest: pullRequestNotification().resource,
      },
    };
    const {params, publishIntegrationEventReceived} = setup(notification);

    await handleAzureDevOpsWebhook(params);

    expect(publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          resource: expect.objectContaining({externalId: EXTERNAL_ID}),
        }),
      }),
    );
  });

  it('publishes a build event without a repository resource', async () => {
    const notification = {
      id: crypto.randomUUID(),
      eventType: 'build.complete',
      resource: {result: 'failed'},
    };
    const {params, publishIntegrationEventReceived} = setup(notification);

    await handleAzureDevOpsWebhook(params);

    const event = (publishIntegrationEventReceived.mock.calls[0] as unknown as [{event: object}])[0]
      .event;
    expect(event).not.toHaveProperty('resource');
  });

  it('falls back to a plain event when a push payload has no default branch', async () => {
    const notification = pushNotification({
      repository: {
        id: REPOSITORY_ID,
        name: 'platform',
        project: {id: PROJECT_ID, name: 'Fabrikam'},
      },
    });
    const {params, publishSourcePush, publishIntegrationEventReceived} = setup(notification);

    await handleAzureDevOpsWebhook(params);

    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
  });

  it('only records an event type it does not publish', async () => {
    const notification = {id: crypto.randomUUID(), eventType: 'workitem.updated', resource: {}};
    const {params, recordDeliveryOnly, publishIntegrationEventReceived} = setup(notification);

    expect(await handleAzureDevOpsWebhook(params)).toBe('recorded-only');
    expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'azure-devops', deliveryId: notification.id}),
    );
  });

  it('only records deliveries for a connection that is not active', async () => {
    const {params, publishSourcePush, recordDeliveryOnly} = setup(pushNotification());
    params.connection = {...params.connection, lifecycleStatus: 'disabled'};

    expect(await handleAzureDevOpsWebhook(params)).toBe('inactive-connection');
    expect(publishSourcePush).not.toHaveBeenCalled();
    expect(recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('publishes every ref of a push that updates several, each with its own delivery id', async () => {
    const tagCommit = 'c'.repeat(40);
    const notification = pushNotification({
      refUpdates: [
        {name: 'refs/heads/main', newObjectId: COMMIT_SHA},
        {name: 'refs/tags/v1.2.0', newObjectId: tagCommit},
        {name: 'refs/heads/gone', newObjectId: '0'.repeat(40)},
      ],
    });
    const {params, publishSourcePush} = setup(notification);

    expect(await handleAzureDevOpsWebhook(params)).toBe('published');

    expect(publishSourcePush).toHaveBeenCalledTimes(2);
    const calls = publishSourcePush.mock.calls as unknown as Array<
      [
        {
          deliveryId: string;
          rawPayload: {id: string; resource: {refUpdates: Array<{name: string}>}};
          push: {ref: string; headCommitSha: string; isDefaultBranch: boolean};
        },
      ]
    >;
    expect(calls.map(([call]) => call.deliveryId)).toEqual([
      `${notification.id}:refs/heads/main`,
      `${notification.id}:refs/tags/v1.2.0`,
    ]);
    // Each push carries only its own ref, so a push-triggered workflow sees one ref per run.
    expect(calls.map(([call]) => call.rawPayload.resource.refUpdates.map((u) => u.name))).toEqual([
      ['refs/heads/main'],
      ['refs/tags/v1.2.0'],
    ]);
    expect(calls[0]?.[0].rawPayload.id).toBe(notification.id);
    expect(calls[1]?.[0].push).toEqual(
      expect.objectContaining({
        ref: 'refs/tags/v1.2.0',
        headCommitSha: tagCommit,
        isDefaultBranch: false,
      }),
    );
  });

  it('reports a duplicate only when every ref of the push was already published', async () => {
    const {params, publishSourcePush} = setup(
      pushNotification({
        refUpdates: [
          {name: 'refs/heads/main', newObjectId: COMMIT_SHA},
          {name: 'refs/heads/other', newObjectId: COMMIT_SHA},
        ],
      }),
    );
    publishSourcePush
      .mockResolvedValueOnce({published: false})
      .mockResolvedValueOnce({published: true});

    expect(await handleAzureDevOpsWebhook(params)).toBe('published');
  });

  it('takes the project of a build event from the envelope resource containers', async () => {
    const notification = {
      id: crypto.randomUUID(),
      eventType: 'build.complete',
      resource: {result: 'failed', repository: {id: REPOSITORY_ID, type: 'TfsGit'}},
      resourceContainers: {project: {id: PROJECT_ID}},
    };
    const {params, publishIntegrationEventReceived} = setup(notification);

    await handleAzureDevOpsWebhook(params);

    expect(publishIntegrationEventReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          resource: expect.objectContaining({externalId: EXTERNAL_ID}),
        }),
      }),
    );
  });
});
