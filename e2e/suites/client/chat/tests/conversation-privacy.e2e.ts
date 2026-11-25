import {ChatPanelScreen} from '@shipfox/e2e-screens-chat';
import {loginAs} from '@shipfox/e2e-setup-auth';
import {
  inviteMember,
  latestConversation,
  readStatus,
  scriptProject,
  waitForTurn,
} from './fixtures.js';
import {expect, test} from './test.js';

const REPLY_TIMEOUT_MS = 60_000;

test('keeps a conversation private to the member who started it', async ({
  browser,
  chatPanel,
  createReadyWorkspace,
}) => {
  const workspace = await createReadyWorkspace({name: 'Chat Privacy Workspace'});
  await scriptProject(workspace, [
    {match: {prompt_contains: 'Only I can see this'}, replies: [{text: 'Noted, just between us.'}]},
  ]);
  const member = await inviteMember(workspace);

  await chatPanel.gotoRuns(workspace.workspaceSlug, workspace.projectSlug);
  await chatPanel.open();
  await chatPanel.send('Only I can see this');
  await expect(chatPanel.message('Noted, just between us.')).toBeVisible({
    timeout: REPLY_TIMEOUT_MS,
  });
  await waitForTurn(workspace, ['succeeded']);
  const conversation = await latestConversation(workspace);

  await test.step('the other member gets the same answer as for a missing conversation', async () => {
    expect(await readStatus(member.sessionToken, `/conversations/${conversation.id}`)).toBe(404);
    expect(await readStatus(member.sessionToken, `/conversations/${conversation.id}/items`)).toBe(
      404,
    );
    expect(
      await readStatus(workspace.sessionToken, `/conversations/${conversation.id}`),
    ).toBeUndefined();
  });

  await test.step('the other member opens Shippy and sees no history', async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await loginAs(page, member.user);
      const theirPanel = new ChatPanelScreen(page);
      await theirPanel.gotoRuns(workspace.workspaceSlug, workspace.projectSlug);
      await theirPanel.open();
      await expect(theirPanel.firstUseTitle()).toBeVisible();
      await expect(theirPanel.message('Only I can see this')).toHaveCount(0);
      await theirPanel.showConversations();
      await expect(theirPanel.panel().getByText('No conversations yet')).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
