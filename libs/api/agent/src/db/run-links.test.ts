import {eq, inArray} from 'drizzle-orm';
import {conversationFactory} from '#test/factories/conversation.js';
import {db} from './db.js';
import {listRunLinkChecks, registerConversationRun, requestRunLinkChecks} from './run-links.js';
import {conversationRunLinks} from './schema/conversation-run-links.js';

describe('run links', () => {
  async function createConversation() {
    const {conversation} = await conversationFactory.create();
    return {conversationId: conversation.id, workspaceId: conversation.workspaceId};
  }

  describe('registerConversationRun', () => {
    it('starts a link with the check requested', async () => {
      const {conversationId, workspaceId} = await createConversation();
      const workflowRunId = crypto.randomUUID();

      const registered = await registerConversationRun({
        workspaceId,
        conversationId,
        workflowRunId,
      });

      expect(registered).toBe(true);
      expect(await listRunLinkChecks(workflowRunId)).toEqual([
        {conversationId, workspaceId, checkRequestedAt: expect.any(String)},
      ]);
    });

    it('keeps one link when the same run is registered again', async () => {
      const {conversationId, workspaceId} = await createConversation();
      const workflowRunId = crypto.randomUUID();

      await registerConversationRun({workspaceId, conversationId, workflowRunId});
      await registerConversationRun({workspaceId, conversationId, workflowRunId});

      const links = await db()
        .select()
        .from(conversationRunLinks)
        .where(eq(conversationRunLinks.workflowRunId, workflowRunId));
      expect(links).toHaveLength(1);
    });

    it('refuses a conversation of another workspace', async () => {
      const {conversationId} = await createConversation();
      const workflowRunId = crypto.randomUUID();

      const registered = await registerConversationRun({
        workspaceId: crypto.randomUUID(),
        conversationId,
        workflowRunId,
      });

      expect(registered).toBe(false);
      expect(await listRunLinkChecks(workflowRunId)).toEqual([]);
    });

    it('refuses a conversation that no longer exists', async () => {
      const registered = await registerConversationRun({
        workspaceId: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
        workflowRunId: crypto.randomUUID(),
      });

      expect(registered).toBe(false);
    });
  });

  describe('requestRunLinkChecks', () => {
    it('counts the links of the run and leaves other runs alone', async () => {
      const first = await createConversation();
      const second = await createConversation();
      const workflowRunId = crypto.randomUUID();
      const otherRunId = crypto.randomUUID();
      await registerConversationRun({...first, workflowRunId});
      await registerConversationRun({...second, workflowRunId});
      await registerConversationRun({...first, workflowRunId: otherRunId});

      await db()
        .update(conversationRunLinks)
        .set({checkRequestedAt: null})
        .where(
          inArray(conversationRunLinks.conversationId, [
            first.conversationId,
            second.conversationId,
          ]),
        );

      expect(await requestRunLinkChecks(workflowRunId)).toBe(2);
      expect(await requestRunLinkChecks(crypto.randomUUID())).toBe(0);

      const requested = await listRunLinkChecks(workflowRunId);
      expect(requested.map((check) => check.conversationId).sort()).toEqual(
        [first.conversationId, second.conversationId].sort(),
      );
      expect(await listRunLinkChecks(otherRunId)).toEqual([]);
    });
  });
});
