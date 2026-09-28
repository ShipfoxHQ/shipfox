import {createDevRunResultSchema} from '@shipfox/api-agent-access-dto';
import {commitFiles} from '@shipfox/e2e-driver-gitea';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import {callTool, connectAgentAccessMcp, waitForIntegrationEvent} from '#agent-access-mcp.js';
import {logText} from '#expect.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {renderWorkflowYaml, seedWorkflowProject} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const ACTION_PATH = './.shipfox/actions/describe-push';
const MAIN_REF = 'refs/heads/main';

test('runs a never-pushed multi-file action from a local-file dev run replay', async ({
  request,
  suite,
}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = `local-dev-run-actions-${uniqueId}`;
  const repo = scenario;
  const configPath = `.shipfox/workflows/${scenario}.yml`;
  const runnerLabel = `e2e-${scenario}`;
  const marker = `uploaded-action-${uniqueId}`;
  const workflowYaml = renderWorkflowYaml({
    suite,
    repo,
    runnerLabel,
    workflowYaml: `
name: Local dev run actions
runner: ${runnerLabel}
triggers:
  on_push:
    source: __GITEA_SOURCE__
    event: push
jobs:
  build:
    steps:
      - key: describe
        uses: ${ACTION_PATH}
        with:
          commit: \${{ event.after }}
`,
  });
  const actionFiles = describePushActionFiles(marker);
  const forgottenHelper = 'lib/text/marker.ts';

  const seeded = await seedWorkflowProject({
    suite,
    token: suite.sessionToken,
    name: scenario,
    repo,
    runnerLabel,
    workflowYaml,
    configPath,
    definitionDelivery: 'api',
  });
  const client = await connectAgentAccessMcp({
    request,
    suite,
    uniqueId,
    clientName: 'Local dev run actions',
  });
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  try {
    // The repository never receives the action: this commit only creates the event to replay.
    const sourceEventFrom = new Date().toISOString();
    const sourceCommit = await commitFiles({
      org: suite.org,
      repo,
      message: 'create a replay source event',
      files: [{path: 'replay-event.txt', content: 'Replay this event with the uploaded action.'}],
    });
    const sourceEvent = await waitForIntegrationEvent({
      client,
      source: suite.connectionSlug,
      event: 'push',
      repositoryFullName: `${suite.org}/${repo}`,
      after: sourceCommit,
      from: sourceEventFrom,
      requireProcessed: true,
      description: `the replay source push for ${repo}`,
    });

    const devRunArguments = {
      project_id: seeded.project.id,
      content: workflowYaml,
      config_path: configPath,
      ref: MAIN_REF,
      trigger: 'on_push',
      replay_event_id: sourceEvent.id,
    };

    const missingHelper = await callTool(client, 'create_dev_run', {
      ...devRunArguments,
      actions: [
        {
          path: ACTION_PATH,
          files: actionFiles.filter((file) => file.path !== forgottenHelper),
        },
      ],
      dry_run: true,
    });
    expect(missingHelper.call.isError).toBe(true);
    expect(missingHelper.envelope).toMatchObject({
      ok: false,
      error: {
        code: 'invalid-definition',
        details: {
          errors: [
            {
              message: `Action ${ACTION_PATH}: lib/describe.ts imports ./text/marker.ts, which is not in the action`,
            },
          ],
        },
      },
    });

    const dryRun = await callTool(client, 'create_dev_run', {
      ...devRunArguments,
      actions: [{path: ACTION_PATH, files: actionFiles}],
      dry_run: true,
    });
    expect(dryRun.envelope.ok).toBe(true);
    if (!dryRun.envelope.ok) throw new Error('Dry run returned an MCP error');
    expect(createDevRunResultSchema.parse(dryRun.envelope.result)).toEqual(
      expect.objectContaining({dry_run: true, check_passed: true}),
    );

    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: suite.sessionToken,
      name: `E2E local dev run actions ${uniqueId}`,
      runnerLabel,
    });
    const realRun = await callTool(client, 'create_dev_run', {
      ...devRunArguments,
      actions: [{path: ACTION_PATH, files: actionFiles}],
    });
    expect(realRun.envelope.ok).toBe(true);
    if (!realRun.envelope.ok) throw new Error('Local dev run returned an MCP error');
    const realRunResult = createDevRunResultSchema.parse(realRun.envelope.result);
    if (!('run_id' in realRunResult)) throw new Error('Local dev run did not return a run id');

    const terminal = await waitForRunTerminalOrFailedRunner({
      runId: realRunResult.run_id,
      token: suite.sessionToken,
      timeoutMs: 180_000,
      runner: localRunner.runner,
      selection: {jobs: [{jobKey: 'build', includeDefaultExecution: true, stepKeys: ['describe']}]},
    });

    // The run list renders `Dev · local file` from `definition_source`, and the uploaded
    // action paths come from `local_actions`.
    expect(terminal).toMatchObject({
      status: 'succeeded',
      origin: 'dev',
      dev_source: {
        definition_source: 'local',
        local_actions: [ACTION_PATH],
        config_path: configPath,
        replay_of_event_id: sourceEvent.id,
      },
    });
    const step = terminal.jobs
      .find((job) => job.key === 'build')
      ?.executions[0]?.steps.find((candidate) => candidate.key === 'describe');
    if (step === undefined) throw new Error('The action step was not observed');
    expect(step).toMatchObject({
      type: 'action',
      status: 'succeeded',
      outputs: {summary: `${marker} ${sourceCommit}`},
    });

    const logs = await fetchStepLogs({
      stepId: step.id,
      attempt: step.current_attempt,
      token: suite.sessionToken,
    });
    expect(logText(logs.records)).toContain(`${marker} ${sourceCommit}`);
  } finally {
    await Promise.all([
      client.close(),
      localRunner === undefined
        ? Promise.resolve()
        : stopLocalRunner(localRunner.runner).catch((error: unknown) => {
            process.stderr.write(
              `local-dev-run-actions-e2e: stopLocalRunner failed: ${String(error)}\n`,
            );
          }),
    ]);
  }
});

/**
 * The action's entry imports a helper that imports a nested helper, so a dry run
 * without the innermost file names the import that would fail on the runner.
 */
function describePushActionFiles(marker: string): {path: string; content: string}[] {
  return [
    {
      path: 'action.yml',
      content: `name: Describe push
main: index.ts
inputs:
  commit:
    required: true
outputs:
  summary:
    required: true
`,
    },
    {
      path: 'index.ts',
      content: `import {defineAction} from '@shipfox/actions';
import {describeCommit} from './lib/describe.ts';

export default defineAction(async ({inputs, log}) => {
  const summary = describeCommit(String(inputs.commit));
  log.info(summary);
  return {summary};
});
`,
    },
    {
      path: 'lib/describe.ts',
      content: `import {MARKER} from './text/marker.ts';

export function describeCommit(commit: string): string {
  return \`\${MARKER} \${commit}\`;
}
`,
    },
    {path: 'lib/text/marker.ts', content: `export const MARKER = '${marker}';\n`},
  ];
}
