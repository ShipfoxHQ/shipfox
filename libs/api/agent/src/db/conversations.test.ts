import {eq} from 'drizzle-orm';
import {conversationFactory} from '#test/factories/conversation.js';
import {claimConversationRunStart} from './conversations.js';
import {db} from './db.js';
import {conversations} from './schema/conversations.js';

describe('claimConversationRunStart', () => {
  async function createConversation() {
    const {conversation} = await conversationFactory.create();
    return {id: conversation.id, workspaceId: conversation.workspaceId};
  }

  async function budget(conversationId: string) {
    const [row] = await db()
      .select({value: conversations.runStartsSinceHuman})
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    return row?.value;
  }

  it('spends one start per claim until the limit', async () => {
    const {id, workspaceId} = await createConversation();

    const claims: boolean[] = [];
    for (let index = 0; index < 4; index += 1) {
      claims.push(await claimConversationRunStart({conversationId: id, workspaceId, limit: 3}));
    }

    expect(claims).toEqual([true, true, true, false]);
    expect(await budget(id)).toBe(3);
  });

  it('never spends past the limit under concurrent claims', async () => {
    const {id, workspaceId} = await createConversation();

    const claims = await Promise.all(
      Array.from({length: 8}, () =>
        claimConversationRunStart({conversationId: id, workspaceId, limit: 5}),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(5);
    expect(await budget(id)).toBe(5);
  });

  it('refuses a conversation of another workspace', async () => {
    const {id} = await createConversation();

    const claimed = await claimConversationRunStart({
      conversationId: id,
      workspaceId: crypto.randomUUID(),
      limit: 5,
    });

    expect(claimed).toBe(false);
    expect(await budget(id)).toBe(0);
  });
});
