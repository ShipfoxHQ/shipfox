import {getScriptedManagedProviderRequests} from '@shipfox/e2e-setup-agent';
import {scriptProject, waitForTurn} from './fixtures.js';
import {expect, test} from './test.js';

const REPLY_TIMEOUT_MS = 60_000;
const STOP_DELAY_MS = 20_000;
const LIST_RUNS_ROW = /list workflow runs/iu;

test.describe('Shippy chat panel', () => {
  test('answers a message with the page the user is on', async ({
    chatPanel,
    createReadyWorkspace,
  }) => {
    const workspace = await createReadyWorkspace({name: 'Chat Reply Workspace'});
    await scriptProject(workspace, [
      {
        match: {prompt_contains: 'What failed recently?'},
        replies: [{text: 'Nothing failed this week.'}],
      },
    ]);

    await chatPanel.gotoRuns(workspace.workspaceSlug, workspace.projectSlug);
    await chatPanel.open();
    await expect(chatPanel.firstUseTitle()).toBeVisible();
    await expect(chatPanel.contextChip('Viewing runs')).toBeVisible();
    await chatPanel.send('What failed recently?');

    await expect(chatPanel.message('What failed recently?')).toBeVisible();
    await expect(chatPanel.message('Nothing failed this week.')).toBeVisible({
      timeout: REPLY_TIMEOUT_MS,
    });
    const [request] = await getScriptedManagedProviderRequests({projectId: workspace.projectId});
    expect(request?.conversation_id).toEqual(expect.any(String));
    expect(request?.prompt).toContain('<page_context page="runs"/>');
  });

  test('shows a tool call and the reply', async ({chatPanel, createReadyWorkspace}) => {
    const workspace = await createReadyWorkspace({name: 'Chat Tool Workspace'});
    await scriptProject(workspace, [
      {
        match: {prompt_contains: 'List the runs'},
        replies: [{tool: 'list_workflow_runs', args: {}}, {text: 'This project has no runs yet.'}],
      },
    ]);

    await chatPanel.gotoRuns(workspace.workspaceSlug, workspace.projectSlug);
    await chatPanel.open();
    await chatPanel.send('List the runs');

    await expect(chatPanel.toolRow(LIST_RUNS_ROW)).toBeVisible({
      timeout: REPLY_TIMEOUT_MS,
    });
    await expect(chatPanel.message('This project has no runs yet.')).toBeVisible({
      timeout: REPLY_TIMEOUT_MS,
    });
    const requests = await getScriptedManagedProviderRequests({projectId: workspace.projectId});
    expect(requests.map((request) => request.served_reply)).toEqual([
      'tool:list_workflow_runs',
      'This project has no runs yet.',
    ]);
  });

  test('stops a reply that is still running', async ({chatPanel, createReadyWorkspace}) => {
    const workspace = await createReadyWorkspace({name: 'Chat Stop Workspace'});
    await scriptProject(workspace, [
      {
        match: {prompt_contains: 'Take your time'},
        replies: [{text: 'This reply never arrives.', delay_ms: STOP_DELAY_MS}],
      },
    ]);

    await chatPanel.gotoRuns(workspace.workspaceSlug, workspace.projectSlug);
    await chatPanel.open();
    await chatPanel.send('Take your time');
    await expect(chatPanel.stopButton()).toBeVisible({timeout: REPLY_TIMEOUT_MS});
    await chatPanel.stopButton().click();

    await expect(chatPanel.stoppedMarker()).toBeVisible({timeout: REPLY_TIMEOUT_MS});
    await expect(chatPanel.message('This reply never arrives.')).toHaveCount(0);
    const conversation = await waitForTurn(workspace, ['stopped']);
    expect(conversation.active_turn).toBeNull();
    await expect(chatPanel.composer()).toBeEnabled();
  });

  test('retries a turn the model provider failed', async ({chatPanel, createReadyWorkspace}) => {
    const workspace = await createReadyWorkspace({name: 'Chat Retry Workspace'});
    await scriptProject(workspace, [
      {
        match: {prompt_contains: 'Try again please'},
        replies: [
          {error: {status: 400, message: 'The scripted provider refused this call.'}},
          {text: 'Second time lucky.'},
        ],
      },
    ]);

    await chatPanel.gotoRuns(workspace.workspaceSlug, workspace.projectSlug);
    await chatPanel.open();
    await chatPanel.send('Try again please');
    await expect(chatPanel.failureNotice()).toBeVisible({timeout: REPLY_TIMEOUT_MS});
    const failed = await waitForTurn(workspace, ['failed']);
    expect(failed.latest_turn?.failure_code).toBe('provider_error');

    await chatPanel.retryButton().click();

    await expect(chatPanel.message('Second time lucky.')).toBeVisible({timeout: REPLY_TIMEOUT_MS});
    await expect(chatPanel.failureNotice()).toHaveCount(0);
    const retried = await waitForTurn(workspace, ['succeeded']);
    expect(retried.latest_turn?.id).not.toBe(failed.latest_turn?.id);
  });
});
