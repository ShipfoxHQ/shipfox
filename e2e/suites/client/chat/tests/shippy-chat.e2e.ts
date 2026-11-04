import {randomUUID} from 'node:crypto';
import {expect, TURN, test} from './test.js';

// The fake provider picks a script by text in the prompt, so each test sends its own marker.
function marker(): string {
  return `chat-e2e-${randomUUID()}`;
}

test.describe('Shippy chat', () => {
  test('streams a reply to a message', async ({createReadyWorkspace, agent, shippyChat}) => {
    const workspace = await createReadyWorkspace();
    const prompt = marker();
    await agent.registerScriptedManagedProvider({
      projectId: workspace.projectId,
      entries: [{match: {prompt_contains: prompt}, replies: [{text: 'Hello from Shippy.'}]}],
    });
    await shippyChat.gotoProject(workspace);
    await shippyChat.open();

    await shippyChat.send(`Hello ${prompt}`);

    await expect(shippyChat.message(`Hello ${prompt}`)).toBeVisible();
    await expect(shippyChat.message('Hello from Shippy.')).toBeVisible(TURN);
  });

  test('shows the tool calls behind a reply', async ({createReadyWorkspace, agent, shippyChat}) => {
    const workspace = await createReadyWorkspace();
    const prompt = marker();
    await agent.registerScriptedManagedProvider({
      projectId: workspace.projectId,
      entries: [
        {
          match: {prompt_contains: prompt},
          replies: [{tool: 'list_workflow_runs', args: {}}, {text: 'This project has no runs.'}],
        },
      ],
    });
    await shippyChat.gotoProject(workspace);
    await shippyChat.open();

    await shippyChat.send(`What ran lately? ${prompt}`);

    await expect(shippyChat.toolCall('List Workflow Runs')).toBeVisible(TURN);
    await expect(shippyChat.message('This project has no runs.')).toBeVisible();
    const requests = await agent.getScriptedManagedProviderRequests({
      projectId: workspace.projectId,
    });
    expect(requests.map((request) => request.served_reply)).toEqual([
      'tool:list_workflow_runs',
      'This project has no runs.',
    ]);
  });

  test('stops a reply and keeps its partial text', async ({
    createReadyWorkspace,
    agent,
    shippyChat,
  }) => {
    const workspace = await createReadyWorkspace();
    const prompt = marker();
    await agent.registerScriptedManagedProvider({
      projectId: workspace.projectId,
      entries: [
        {
          match: {prompt_contains: prompt},
          replies: [{text: 'Reading the run now.', hold_ms: 60_000}],
        },
      ],
    });
    await shippyChat.gotoProject(workspace);
    await shippyChat.open();
    await shippyChat.send(`Why did it fail? ${prompt}`);
    await expect(shippyChat.message('Reading the run now.')).toBeVisible(TURN);

    await shippyChat.stopReply();

    await expect(shippyChat.stoppedFooter()).toBeVisible(TURN);
    await expect(shippyChat.message('Reading the run now.')).toBeVisible();
  });

  test('retries a failed reply', async ({createReadyWorkspace, agent, shippyChat}) => {
    const workspace = await createReadyWorkspace();
    const prompt = marker();
    await agent.registerScriptedManagedProvider({
      projectId: workspace.projectId,
      entries: [
        {
          match: {prompt_contains: prompt},
          replies: [
            {error: {status: 400, message: 'Scripted provider failure'}},
            {text: 'Here is the answer.'},
          ],
        },
      ],
    });
    await shippyChat.gotoProject(workspace);
    await shippyChat.open();
    await shippyChat.send(`Summarize the runs ${prompt}`);
    await expect(shippyChat.failure()).toBeVisible(TURN);

    await shippyChat.retry();

    await expect(shippyChat.message('Here is the answer.')).toBeVisible(TURN);
    await expect(shippyChat.failure()).toBeHidden();
  });
});
