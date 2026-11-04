import {randomUUID} from 'node:crypto';
import {E2eApiError} from '@shipfox/e2e-core';
import {expect, test} from './test.js';

test.describe('Shippy chat privacy', () => {
  test("hides a member's conversation from another member, even an admin", async ({
    createReadyWorkspace,
    agent,
    auth,
    members,
    conversations,
    page,
    shippyChat,
  }) => {
    const workspace = await createReadyWorkspace();
    const prompt = `chat-e2e-${randomUUID()}`;
    await agent.registerScriptedManagedProvider({
      projectId: workspace.projectId,
      entries: [{match: {prompt_contains: prompt}, replies: [{text: 'Only you can read this.'}]}],
    });
    const {conversation} = await conversations.start({
      sessionToken: workspace.sessionToken,
      projectId: workspace.projectId,
      body: `A private question ${prompt}`,
    });
    await expect(
      conversations.get({sessionToken: workspace.sessionToken, conversationId: conversation.id}),
    ).resolves.toMatchObject({id: conversation.id});
    const member = await members.join(workspace);
    await auth.loginAs(page, member.user);

    await shippyChat.gotoProject(workspace);
    await shippyChat.open();
    await shippyChat.showConversations();

    await expect(shippyChat.emptyHistory()).toBeVisible();
    const read = conversations.get({
      sessionToken: member.sessionToken,
      conversationId: conversation.id,
    });
    await expect(read).rejects.toBeInstanceOf(E2eApiError);
    await expect(read).rejects.toMatchObject({status: 404});
  });
});
