import {logger} from '@shipfox/node-opentelemetry';
import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {registerConversationRun} from '#db/run-links.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {runOverview} from '#test/fixtures/run-overview.js';
import {createOnRunLifecycle} from './on-run-lifecycle.js';

describe('onRunLifecycle', () => {
  const wake = vi.fn().mockResolvedValue(undefined);

  async function arrangeLink() {
    const {conversation} = await conversationFactory.create();
    const workflowRunId = crypto.randomUUID();
    await registerConversationRun({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      workflowRunId,
    });
    return {conversation, workflowRunId};
  }

  function terminatedEvent(workflowRunId: string) {
    return {
      workflowRunId,
      workflowRunAttemptId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      status: 'succeeded',
    } as never;
  }

  async function deliveredCount(conversationId: string) {
    const rows = await db()
      .select({id: conversationItems.id})
      .from(conversationItems)
      .where(
        and(
          eq(conversationItems.conversationId, conversationId),
          eq(conversationItems.entryType, 'custom_message'),
        ),
      );
    return rows.length;
  }

  beforeEach(() => wake.mockClear());

  it('delivers the result of a run that ended', async () => {
    const {conversation, workflowRunId} = await arrangeLink();
    const getWorkflowRunOverview = vi
      .fn()
      .mockResolvedValue(runOverview({runId: workflowRunId, status: 'succeeded'}));
    const handle = createOnRunLifecycle({workflows: {getWorkflowRunOverview}, wake});

    await handle(terminatedEvent(workflowRunId));

    expect(await deliveredCount(conversation.id)).toBe(1);
    expect(wake).toHaveBeenCalledWith(conversation.id);
  });

  it('reads nothing for a run no conversation started', async () => {
    const getWorkflowRunOverview = vi.fn();
    const handle = createOnRunLifecycle({workflows: {getWorkflowRunOverview}, wake});

    await handle(terminatedEvent(crypto.randomUUID()));

    expect(getWorkflowRunOverview).not.toHaveBeenCalled();
  });

  it('logs a failed check and never throws, leaving it for the sweep', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const {workflowRunId} = await arrangeLink();
    const getWorkflowRunOverview = vi.fn().mockRejectedValue(new Error('workflows is down'));
    const handle = createOnRunLifecycle({workflows: {getWorkflowRunOverview}, wake});

    await expect(handle(terminatedEvent(workflowRunId))).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({workflowRunId}),
      'Failed to check a workflow run for delivery to its conversations',
    );
  });
});
