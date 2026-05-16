import type {
  GithubPushPayload,
  IntegrationEventReceivedEvent,
} from '@shipfox/api-integration-core-dto';
import {PROJECT_SOURCE_COMMIT_OBSERVED} from '@shipfox/api-projects-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projectFactory} from '#test/index.js';
import {onIntegrationEventReceived} from './on-integration-event-received.js';

function buildPushPayload(overrides: Partial<GithubPushPayload> = {}): GithubPushPayload {
  return {
    externalRepositoryId: 'github:42',
    ref: 'main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
    ...overrides,
  };
}

function buildEnvelope(
  overrides: Partial<IntegrationEventReceivedEvent> = {},
  pushOverrides: Partial<GithubPushPayload> = {},
): IntegrationEventReceivedEvent {
  return {
    source: 'github',
    event: 'push',
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    connectionId: overrides.connectionId ?? crypto.randomUUID(),
    deliveryId: overrides.deliveryId ?? crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    payload: buildPushPayload(pushOverrides),
    ...overrides,
  };
}

function buildEvent(payload: IntegrationEventReceivedEvent, id = crypto.randomUUID()): DomainEvent {
  return {
    id,
    type: 'integrations.event.received',
    createdAt: new Date(),
    payload,
  };
}

async function listCommitObservedEvents(externalRepositoryId: string) {
  return await db()
    .select()
    .from(projectsOutbox)
    .where(
      and(
        eq(projectsOutbox.eventType, PROJECT_SOURCE_COMMIT_OBSERVED),
        sql`${projectsOutbox.payload}->>'externalRepositoryId' = ${externalRepositoryId}`,
      ),
    );
}

describe('onIntegrationEventReceived', () => {
  it('publishes a project source commit event for a default-branch github push', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const project = await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const envelope = buildEnvelope(
      {workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId},
    );

    await onIntegrationEventReceived(buildEvent(envelope));

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({
      workspaceId,
      projectId: project.id,
      sourceConnectionId,
      provider: 'github',
      externalRepositoryId,
      ref: 'main',
      headCommitSha: 'abc123',
    });
  });

  it('does not publish for a non-default branch push', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const envelope = buildEnvelope(
      {workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId, ref: 'feature/x', isDefaultBranch: false},
    );

    await onIntegrationEventReceived(buildEvent(envelope));

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(0);
  });

  it('ignores non-github sources', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `gitlab:${crypto.randomUUID()}`;
    await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const envelope = buildEnvelope(
      {source: 'gitlab', workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId},
    );

    await onIntegrationEventReceived(buildEvent(envelope));

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(0);
  });

  it('ignores non-push events', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const envelope = buildEnvelope(
      {event: 'issue_comment', workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId},
    );

    await onIntegrationEventReceived(buildEvent(envelope));

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(0);
  });

  it('does not publish when no project is bound to the pushed repository', async () => {
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const envelope = buildEnvelope({}, {externalRepositoryId});

    await onIntegrationEventReceived(buildEvent(envelope));

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(0);
  });

  it('deduplicates the same integration event for the same project', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const envelope = buildEnvelope(
      {workspaceId, connectionId: sourceConnectionId},
      {externalRepositoryId},
    );
    const event = buildEvent(envelope);

    await onIntegrationEventReceived(event);
    await onIntegrationEventReceived(event);

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(1);
  });
});
