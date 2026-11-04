import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {registerConversationRun} from '#db/run-links.js';
import {conversationRunLinks} from '#db/schema/conversation-run-links.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {runOverview} from '#test/fixtures/run-overview.js';
import {recoverConversations} from './recover-conversations.js';

describe('recoverConversations run results', () => {
  async function arrangeStaleLink() {
    const {conversation} = await conversationFactory.create();
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

    expect(wake).toHaveBeenCalledWith(conversation.id);
  });

  it('only wakes when no workflows client exists', async () => {
    await arrangeStaleLink();

    const result = await recoverConversations({wake: vi.fn().mockResolvedValue(undefined)});

    expect(result.checked).toBe(0);
  });
});
