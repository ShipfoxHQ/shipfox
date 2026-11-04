import {and, eq, inArray, isNotNull, isNull, sql} from 'drizzle-orm';
import {claimQueuedConversationItems} from '#db/conversations.js';
import {db} from '#db/db.js';
import {registerConversationRun} from '#db/run-links.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {conversationRunLinks} from '#db/schema/conversation-run-links.js';
import {conversations} from '#db/schema/conversations.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {runOverview} from '#test/fixtures/run-overview.js';
import {recoverConversations} from './recover-conversations.js';

describe('recoverConversations run results', () => {
  const conversationIds: string[] = [];

  afterEach(async () => {
    if (conversationIds.length > 0) {
      await db().delete(conversations).where(inArray(conversations.id, conversationIds));
    }
    conversationIds.length = 0;
  });

  /** The queued run results of a conversation, which are the only inputs it should have left. */
  async function queuedRunResults(conversationId: string) {
    return await db()
      .select({id: conversationItems.id})
      .from(conversationItems)
      .where(
        and(
          eq(conversationItems.conversationId, conversationId),
          isNull(conversationItems.seq),
          isNotNull(conversationItems.runAttemptId),
        ),
      );
  }

  async function arrangeStaleLink() {
    const {conversation} = await conversationFactory.create();
    conversationIds.push(conversation.id);
    // The factory queues a first message, which would wake the conversation by itself.
    await claimQueuedConversationItems(conversation.id);
    const workflowRunId = crypto.randomUUID();
    await registerConversationRun({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      workflowRunId,
    });
    await db()
      .update(conversationRunLinks)
      .set({checkRequestedAt: sql`NOW() - INTERVAL '2 minutes'`})
      .where(eq(conversationRunLinks.conversationId, conversation.id));
    return {conversation, workflowRunId};
  }

  it('delivers a result that no event delivered, and wakes the conversation', async () => {
    const {conversation, workflowRunId} = await arrangeStaleLink();
    const wake = vi.fn().mockResolvedValue(undefined);
    const getWorkflowRunOverview = vi.fn((input: {workflowRunId: string}) =>
      Promise.resolve(
        input.workflowRunId === workflowRunId
          ? runOverview({runId: workflowRunId, status: 'succeeded'})
          : null,
      ),
    );

    const result = await recoverConversations({
      wake,
      workflows: {getWorkflowRunOverview} as never,
    });

    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(await queuedRunResults(conversation.id)).toHaveLength(1);
    expect(wake).toHaveBeenCalledWith(conversation.id);
  });

  it('wakes a conversation whose result was queued but whose wake was lost', async () => {
    const {conversation, workflowRunId} = await arrangeStaleLink();
    const getWorkflowRunOverview = vi.fn((input: {workflowRunId: string}) =>
      Promise.resolve(
        input.workflowRunId === workflowRunId
          ? runOverview({runId: workflowRunId, status: 'succeeded'})
          : null,
      ),
    );
    await recoverConversations({
      wake: vi.fn().mockResolvedValue(undefined),
      workflows: {getWorkflowRunOverview} as never,
    });
    const wake = vi.fn().mockResolvedValue(undefined);

    await recoverConversations({wake});

    expect(await queuedRunResults(conversation.id)).toHaveLength(1);
    expect(wake).toHaveBeenCalledWith(conversation.id);
  });

  it('only wakes when no workflows client exists', async () => {
    await arrangeStaleLink();

    const result = await recoverConversations({wake: vi.fn().mockResolvedValue(undefined)});

    expect(result.checked).toBe(0);
  });
});
