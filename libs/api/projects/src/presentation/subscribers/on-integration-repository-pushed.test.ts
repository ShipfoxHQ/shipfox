import type {IntegrationRepositoryPushedEvent} from '@shipfox/api-integration-core-dto';
import {PROJECT_SOURCE_COMMIT_OBSERVED} from '@shipfox/api-projects-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projectFactory} from '#test/index.js';
import {onIntegrationRepositoryPushed} from './on-integration-repository-pushed.js';

function buildPayload(
  overrides: Partial<IntegrationRepositoryPushedEvent> = {},
): IntegrationRepositoryPushedEvent {
  return {
    provider: 'github',
    connectionId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    externalRepositoryId: 'github:42',
    ref: 'main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildEvent(
  payload: IntegrationRepositoryPushedEvent,
  id = crypto.randomUUID(),
): DomainEvent {
  return {
    id,
    type: 'integrations.repository.pushed',
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

describe('onIntegrationRepositoryPushed', () => {
  it('publishes a project source commit event for a default-branch push', async () => {
    const sourceConnectionId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const project = await projectFactory.create({
      workspaceId,
      sourceConnectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    const payload = buildPayload({
      workspaceId,
      connectionId: sourceConnectionId,
      externalRepositoryId,
    });

    const result = onIntegrationRepositoryPushed(buildEvent(payload));
    await result;

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
    const payload = buildPayload({
      workspaceId,
      connectionId: sourceConnectionId,
      externalRepositoryId,
      ref: 'feature/x',
      isDefaultBranch: false,
    });

    const result = onIntegrationRepositoryPushed(buildEvent(payload));
    await result;

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(0);
  });

  it('does not publish when no project is bound to the pushed repository', async () => {
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const payload = buildPayload({externalRepositoryId});

    const result = onIntegrationRepositoryPushed(buildEvent(payload));
    await result;

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
    const payload = buildPayload({
      workspaceId,
      connectionId: sourceConnectionId,
      externalRepositoryId,
    });
    const event = buildEvent(payload);

    const firstResult = onIntegrationRepositoryPushed(event);
    await firstResult;
    const secondResult = onIntegrationRepositoryPushed(event);
    await secondResult;

    const rows = await listCommitObservedEvents(externalRepositoryId);
    expect(rows).toHaveLength(1);
  });
});
