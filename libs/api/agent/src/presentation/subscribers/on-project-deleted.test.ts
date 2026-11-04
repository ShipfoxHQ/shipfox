import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {insertIntegrationConversation} from '#db/conversations.js';
import {
  agentDeletedScopes,
  claimSession,
  createSession,
  db,
  recordProjectAgentDeleted,
  sessions,
} from '#db/index.js';
import {conversations} from '#db/schema/conversations.js';
import {turns} from '#db/schema/turns.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {onProjectDeleted} from './on-project-deleted.js';

function deletedEvent(params: {workspaceId: string; projectId: string}) {
  return {...params, deletedBy: crypto.randomUUID(), deletedAt: new Date().toISOString()};
}

async function createSessionFor(params: {workspaceId: string; projectId: string}) {
  return await db().transaction((tx) =>
    createSession(tx, {
      ...params,
      workflowRunAttemptId: crypto.randomUUID(),
      key: 'main',
      harness: 'pi',
    }),
  );
}

describe('onProjectDeleted', () => {
  it('deletes the conversations, their children, and the sessions of the project', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({workspaceId, projectId});
    await turnFactory.create({conversationId: conversation.id, status: 'succeeded'});
    await createSessionFor({workspaceId, projectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    expect(
      await db().select().from(conversations).where(eq(conversations.projectId, projectId)),
    ).toEqual([]);
    expect(
      await db().select().from(turns).where(eq(turns.conversationId, conversation.id)),
    ).toEqual([]);
    expect(await db().select().from(sessions).where(eq(sessions.projectId, projectId))).toEqual([]);
    const [marker] = await db()
      .select()
      .from(agentDeletedScopes)
      .where(eq(agentDeletedScopes.projectId, projectId));
    expect(marker?.purgedAt).not.toBeNull();
  });

  it('keeps another project untouched', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const otherProjectId = crypto.randomUUID();
    await conversationFactory.create({workspaceId, projectId});
    const {conversation: other} = await conversationFactory.create({
      workspaceId,
      projectId: otherProjectId,
    });
    const otherSession = await createSessionFor({workspaceId, projectId: otherProjectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    const kept = await db().select().from(conversations).where(eq(conversations.id, other.id));
    expect(kept).toHaveLength(1);
    const keptSessions = await db().select().from(sessions).where(eq(sessions.id, otherSession.id));
    expect(keptSessions).toHaveLength(1);
  });

  it('keeps a conversation with a running turn and asks for redelivery', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const {conversation} = await conversationFactory.create({workspaceId, projectId});
    const turn = await turnFactory.create({conversationId: conversation.id, status: 'running'});

    await expect(onProjectDeleted(deletedEvent({workspaceId, projectId}))).rejects.toThrow(
      'still stopping',
    );
    expect(
      await db().select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toHaveLength(1);

    await db().update(turns).set({status: 'stopped'}).where(eq(turns.id, turn.id));
    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    expect(
      await db().select().from(conversations).where(eq(conversations.id, conversation.id)),
    ).toEqual([]);
  });

  it('is safe to repeat', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await conversationFactory.create({workspaceId, projectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));
    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    const markers = await db()
      .select()
      .from(agentDeletedScopes)
      .where(eq(agentDeletedScopes.projectId, projectId));
    expect(markers).toHaveLength(1);
  });

  it('refuses later conversation and session writes for the project', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await recordProjectAgentDeleted({workspaceId, projectId});

    const integration = insertIntegrationConversation({
      id: crypto.randomUUID(),
      workspaceId,
      projectId,
      agentKey: 'shippy',
      origin: {connectionId: crypto.randomUUID(), provider: 'slack', key: crypto.randomUUID()},
      firstInput: {
        id: crypto.randomUUID(),
        clientMessageId: crypto.randomUUID(),
        sessionVersion: 1,
        sealedEntry: Buffer.from('sealed'),
        meta: {role: 'user'},
      },
    });
    const created = createSessionFor({workspaceId, projectId});
    const claimed = claimSession({
      workspaceId,
      projectId,
      workflowRunAttemptId: crypto.randomUUID(),
      key: 'main',
      harness: 'pi',
      stepAttemptId: crypto.randomUUID(),
    });

    await expect(integration).rejects.toBeInstanceOf(ScopeDeletedError);
    await expect(created).rejects.toBeInstanceOf(ScopeDeletedError);
    await expect(claimed).rejects.toBeInstanceOf(ScopeDeletedError);
  });
});
