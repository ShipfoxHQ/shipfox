import {PollTimeoutError} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import {createNotionConnection} from '@shipfox/e2e-setup-integrations';
import {startNotionApiMock} from '#notion-api.js';
import {postNotionDelivery} from '#notion-events.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

test('starts a run from a signed Notion delivery and calls the get_page tool step', async ({
  suite,
}: {
  suite: SuiteContext;
}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const pageId = crypto.randomUUID();
  const botId = crypto.randomUUID();
  const authorizedByUserId = crypto.randomUUID();
  const notionWorkspaceId = crypto.randomUUID();
  const accessToken = `notion-access-token-${uniqueId}`;
  const notionApi = await startNotionApiMock();
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  try {
    const connection = await createNotionConnection({
      workspaceId: suite.workspaceId,
      notionWorkspaceId,
      workspaceName: `E2E Notion ${uniqueId}`,
      botId,
      authorizedByUserId,
      accessToken,
      displayName: `Notion E2E ${uniqueId}`,
    });
    const runnerLabel = `e2e-notion-tool-step-${uniqueId}`;
    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: suite.sessionToken,
      name: `E2E Notion tool step ${uniqueId}`,
      runnerLabel,
    });

    const {project} = await seedProjectWithApiDefinition({
      suite,
      token: suite.sessionToken,
      name: 'notion-tool-step',
      repo: `notion-tool-step-${uniqueId}`,
      runnerLabel,
      workflowYaml: notionToolStepWorkflowYaml(connection.slug, pageId),
      configPath: '.shipfox/workflows/notion-tool-step.yml',
    });

    const personDeliveryId = `notion-person-${uniqueId}`;
    const personRun = await triggerNotionDeliveryAndAwaitRun({
      deliveryId: personDeliveryId,
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token: suite.sessionToken,
      notionWorkspaceId,
      botId,
      pageId,
      actorId: authorizedByUserId,
    });
    const personTerminal = await waitForRunTerminalOrFailedRunner({
      runId: personRun,
      token: suite.sessionToken,
      timeoutMs: 60_000,
      runner: localRunner.runner,
      selection: {
        jobs: [
          {
            jobKey: 'read_page',
            includeDefaultExecution: true,
            stepKeys: ['get_page', 'consume_page'],
          },
        ],
      },
    });

    expect(personTerminal.status).toBe('succeeded');
    const personJob = personTerminal.jobs.find((job) => job.key === 'read_page');
    expect(personJob?.status).toBe('succeeded');
    expect(personJob?.executions[0]?.steps.find((step) => step.key === 'get_page')?.status).toBe(
      'succeeded',
    );
    expect(
      personJob?.executions[0]?.steps.find((step) => step.key === 'consume_page')?.status,
    ).toBe('succeeded');

    const botDeliveryId = `notion-bot-${uniqueId}`;
    const botRun = await triggerNotionDeliveryAndAwaitRun({
      deliveryId: botDeliveryId,
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token: suite.sessionToken,
      notionWorkspaceId,
      botId,
      pageId,
      actorId: botId,
      actorType: 'bot',
    });
    expect(botRun).not.toBe(personRun);
    const botTerminal = await waitForRunTerminalOrFailedRunner({
      runId: botRun,
      token: suite.sessionToken,
      timeoutMs: 60_000,
      runner: localRunner.runner,
    });
    expect(botTerminal.status).toBe('succeeded');

    const inaccessibleDeliveryId = `notion-inaccessible-${uniqueId}`;
    await postNotionDelivery({
      deliveryId: inaccessibleDeliveryId,
      workspaceId: notionWorkspaceId,
      botId,
      pageId,
      actorId: authorizedByUserId,
      accessibleBy: [{id: crypto.randomUUID(), type: 'bot'}],
    });
    await expect(
      waitForRunByDeliveryId({
        projectId: project.id,
        deliveryId: inaccessibleDeliveryId,
        token: suite.sessionToken,
        timeoutMs: 5_000,
        workspaceId: suite.workspaceId,
      }),
    ).rejects.toBeInstanceOf(PollTimeoutError);

    expect(notionApi.calls).toEqual([
      {
        kind: 'get_page',
        authorization: `Bearer ${accessToken}`,
        pageId,
      },
      {
        kind: 'get_page',
        authorization: `Bearer ${accessToken}`,
        pageId,
      },
    ]);
  } finally {
    await Promise.all([
      notionApi.stop().catch((error: unknown) => {
        process.stderr.write(`notion-tool-step-e2e: stopNotionApiMock failed: ${String(error)}\n`);
      }),
      localRunner === undefined
        ? Promise.resolve()
        : stopLocalRunner(localRunner.runner).catch((error: unknown) => {
            process.stderr.write(
              `notion-tool-step-e2e: stopLocalRunner failed: ${String(error)}\n`,
            );
          }),
    ]);
  }
});

async function triggerNotionDeliveryAndAwaitRun(params: {
  deliveryId: string;
  projectId: string;
  workspaceId: string;
  token: string;
  notionWorkspaceId: string;
  botId: string;
  pageId: string;
  actorId: string;
  actorType?: 'person' | 'bot' | 'agent';
}): Promise<string> {
  const deliveryId = await postNotionDelivery({
    deliveryId: params.deliveryId,
    workspaceId: params.notionWorkspaceId,
    botId: params.botId,
    pageId: params.pageId,
    actorId: params.actorId,
    ...(params.actorType === undefined ? {} : {actorType: params.actorType}),
  });
  const run = await waitForRunByDeliveryId({
    projectId: params.projectId,
    deliveryId,
    token: params.token,
    timeoutMs: 15_000,
    workspaceId: params.workspaceId,
  });
  return run.id;
}

function notionToolStepWorkflowYaml(connectionSlug: string, pageId: string): string {
  return `
name: Notion tool step
runner: __RUNNER_LABEL__
triggers:
  on_page_change:
    source: ${connectionSlug}
    event: page.properties_updated
    filter: 'event.entity.id == "${pageId}"'
jobs:
  read_page:
    steps:
      - key: get_page
        name: Read Notion page
        tool: get_page
        connection: ${connectionSlug}
        with:
          page_id: '\${{ event.entity.id }}'
        outputs:
          title: '\${{ result.title }}'
      - key: consume_page
        name: Consume Notion page output
        env:
          PAGE_TITLE: '\${{ steps.get_page.outputs.title }}'
        run: |
          test "$PAGE_TITLE" = "E2E Notion page"
`;
}
