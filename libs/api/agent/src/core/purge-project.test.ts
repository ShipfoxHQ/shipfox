import {describe, expect, it} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {agentDeletedScopes, db, recordProjectAgentDeleted} from '#db/index.js';
import {conversations} from '#db/schema/conversations.js';
import {turns} from '#db/schema/turns.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {purgeUnfinishedDeletedProjects} from './purge-project.js';

async function purgedAt(projectId: string) {
  const [marker] = await db()
    .select()
    .from(agentDeletedScopes)
    .where(eq(agentDeletedScopes.projectId, projectId));
  return marker?.purgedAt;
}

describe('purgeUnfinishedDeletedProjects', () => {
  it('finishes the purge of a marked project that still has conversations', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({workspaceId, projectId});
    await recordProjectAgentDeleted({workspaceId, projectId});

    const result = await purgeUnfinishedDeletedProjects();

    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect(
      await db().select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toEqual([]);
    expect(await purgedAt(projectId)).toBeInstanceOf(Date);
  });

  it('purges a conversation once its running turn has stopped', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({workspaceId, projectId});
    const turn = await turnFactory.create({conversationId: conversation.id, status: 'running'});
    await recordProjectAgentDeleted({workspaceId, projectId});

    await purgeUnfinishedDeletedProjects();

    expect(
      await db().select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toHaveLength(1);
    expect(await purgedAt(projectId)).toBeNull();

    await db().update(turns).set({status: 'stopped'}).where(eq(turns.id, turn.id));
    await purgeUnfinishedDeletedProjects();

    expect(
      await db().select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toEqual([]);
    expect(await purgedAt(projectId)).toBeInstanceOf(Date);
  });

  it('leaves the conversations of a project that was never marked', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({workspaceId, projectId});

    await purgeUnfinishedDeletedProjects();

    expect(
      await db().select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toHaveLength(1);
  });

  it('does not purge a project again once it is purged', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await recordProjectAgentDeleted({workspaceId, projectId});
    await purgeUnfinishedDeletedProjects();
    const first = await purgedAt(projectId);
    expect(first).toBeInstanceOf(Date);

    await purgeUnfinishedDeletedProjects();

    expect(await purgedAt(projectId)).toEqual(first);
  });
});
