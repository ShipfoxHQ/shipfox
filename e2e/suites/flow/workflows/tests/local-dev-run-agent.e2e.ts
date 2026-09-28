import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {
  createDevRunResultSchema,
  getWorkflowRunSourceResultSchema,
  listWorkflowDefinitionsResultSchema,
} from '@shipfox/api-agent-access-dto';
import {PollTimeoutError, pollUntil} from '@shipfox/e2e-core';
import {commitFiles} from '@shipfox/e2e-driver-gitea';
import {
  callTool,
  connectAgentAccessMcp,
  getRun,
  getRuns,
  getTriggerEvent,
  waitForIntegrationEvent,
} from '#agent-access-mcp.js';
import {renderWorkflowYaml, seedWorkflowProject} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const MAIN_REF = 'refs/heads/main';
const RUN_STABILITY_TIMEOUT_MS = 2_000;
const textEncoder = new TextEncoder();

test('covers the local dev-run loop through the agent MCP tool', async ({request, suite}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = `local-dev-run-agent-${uniqueId}`;
  const repo = scenario;
  const configPath = `.shipfox/workflows/${scenario}.yml`;
  const runnerLabel = `e2e-${scenario}`;
  const workflowYaml = renderWorkflowYaml({
    suite,
    repo,
    runnerLabel,
    workflowYaml: `
name: Local dev run agent
runner: ${runnerLabel}
triggers:
  on_push:
    source: __GITEA_SOURCE__
    event: push
jobs:
  build:
    steps:
      - key: build
        run: echo "local dev run"
`,
  });

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
    clientName: 'Local dev run',
  });

  try {
    const sourceEventFrom = new Date().toISOString();
    const sourceCommit = await commitFiles({
      org: suite.org,
      repo,
      message: 'create a replay source event',
      files: [{path: 'replay-event.txt', content: 'Replay this event for the local dev run.'}],
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

    const invalid = await callTool(client, 'create_dev_run', {
      project_id: seeded.project.id,
      content: 'name: [invalid',
      config_path: configPath,
      ref: MAIN_REF,
      trigger: 'on_push',
      replay_event_id: sourceEvent.id,
      dry_run: true,
    });
    expect(invalid.call.isError).toBe(true);
    expect(invalid.envelope).toMatchObject({
      ok: false,
      error: {code: 'invalid-definition'},
    });
    if (invalid.envelope.ok || invalid.envelope.error === undefined) {
      throw new Error('Invalid local workflow did not return an MCP error');
    }
    const invalidDetails = invalid.envelope.error.details;
    expect(invalidDetails).toBeDefined();
    expect(invalidDetails).toEqual(
      expect.objectContaining({
        errors: expect.any(Array),
        total: expect.any(Number),
        truncated: expect.any(Boolean),
      }),
    );
    expect(textEncoder.encode(JSON.stringify(invalidDetails ?? {})).byteLength).toBeLessThanOrEqual(
      4096,
    );

    const beforeDryRun = await getRuns(client, seeded.project.id);
    const sourceEventAfterInvalid = await getTriggerEvent(client, sourceEvent.id);
    expect(beforeDryRun).toHaveLength(0);
    expect(sourceEventAfterInvalid.replays).toEqual([]);
    expect(sourceEventAfterInvalid.replays_total_count).toBe(0);

    const dryRun = await callTool(client, 'create_dev_run', {
      project_id: seeded.project.id,
      content: workflowYaml,
      config_path: configPath,
      ref: MAIN_REF,
      trigger: 'on_push',
      replay_event_id: sourceEvent.id,
      dry_run: true,
    });
    expect(dryRun.call.isError).not.toBe(true);
    expect(dryRun.envelope.ok).toBe(true);
    if (!dryRun.envelope.ok) throw new Error('Dry run returned an MCP error');
    const dryRunResult = createDevRunResultSchema.parse(dryRun.envelope.result);
    expect(dryRunResult).toEqual(
      expect.objectContaining({
        dry_run: true,
        check_passed: true,
        ref: MAIN_REF,
        commit: expect.stringMatching(COMMIT_SHA_PATTERN),
      }),
    );
    expect(await getRuns(client, seeded.project.id)).toHaveLength(0);
    const sourceEventAfterDryRun = await getTriggerEvent(client, sourceEvent.id);
    expect(sourceEventAfterDryRun.replays).toEqual([]);
    expect(sourceEventAfterDryRun.replays_total_count).toBe(0);

    const realRun = await callTool(client, 'create_dev_run', {
      project_id: seeded.project.id,
      content: workflowYaml,
      config_path: configPath,
      ref: MAIN_REF,
      trigger: 'on_push',
      replay_event_id: sourceEvent.id,
    });
    expect(realRun.call.isError).not.toBe(true);
    expect(realRun.envelope.ok).toBe(true);
    if (!realRun.envelope.ok) throw new Error('Real local run returned an MCP error');
    const realRunResult = createDevRunResultSchema.parse(realRun.envelope.result);
    if (!('run_id' in realRunResult)) throw new Error('Real local run did not return a run id');
    expect(realRunResult.ref).toBe(dryRunResult.ref);
    expect(realRunResult.commit).toBe(dryRunResult.commit);
    expect(await getTriggerEvent(client, sourceEvent.id)).toMatchObject({
      replays: [{workflow_run_id: realRunResult.run_id}],
      replays_total_count: 1,
    });

    const run = await getRun(client, realRunResult.run_id);
    expect(run).toMatchObject({
      id: realRunResult.run_id,
      project_id: seeded.project.id,
      origin: 'dev',
      dev_source: expect.objectContaining({
        config_path: configPath,
        definition_source: 'local',
        replay_of_event_id: sourceEvent.id,
      }),
    });

    const source = await callTool(client, 'get_workflow_run_source', {
      run_id: realRunResult.run_id,
    });
    expect(source.call.isError).not.toBe(true);
    expect(source.envelope.ok).toBe(true);
    if (!source.envelope.ok) throw new Error('Run source returned an MCP error');
    expect(getWorkflowRunSourceResultSchema.parse(source.envelope.result)).toEqual(
      expect.objectContaining({
        kind: 'available',
        source_snapshot: {content: workflowYaml, format: 'yaml'},
      }),
    );

    const definitions = await callTool(client, 'list_workflow_definitions', {
      project_id: seeded.project.id,
    });
    expect(definitions.call.isError).not.toBe(true);
    expect(definitions.envelope.ok).toBe(true);
    if (!definitions.envelope.ok) throw new Error('Definitions list returned an MCP error');
    expect(
      listWorkflowDefinitionsResultSchema.parse(definitions.envelope.result).definitions,
    ).toEqual([]);

    const runIdsBeforeLiveEvent = (await getRuns(client, seeded.project.id)).map(({id}) => id);
    const secondEventFrom = new Date().toISOString();
    const secondCommit = await commitFiles({
      org: suite.org,
      repo,
      message: 'create a second live event',
      files: [{path: 'live-event.txt', content: 'This must not start a workflow.'}],
    });
    const secondEvent = await waitForIntegrationEvent({
      client,
      source: suite.connectionSlug,
      event: 'push',
      repositoryFullName: `${suite.org}/${repo}`,
      after: secondCommit,
      from: secondEventFrom,
      requireProcessed: true,
      description: `the second live push for ${repo}`,
      excludedIds: new Set([sourceEvent.id]),
    });
    expect(secondEvent.id).not.toBe(sourceEvent.id);
    await expectRunIdsToRemain(client, seeded.project.id, runIdsBeforeLiveEvent);

    const filtered = await callTool(client, 'create_dev_run', {
      project_id: seeded.project.id,
      content: workflowYaml.replace(
        'event: push',
        'event: push\n    filter: \'event.ref == "refs/heads/never"\'',
      ),
      config_path: `${configPath}.filtered.yml`,
      ref: MAIN_REF,
      trigger: 'on_push',
      replay_event_id: sourceEvent.id,
    });
    expect(filtered.call.isError).toBe(true);
    expect(filtered.envelope).toMatchObject({
      ok: false,
      error: {
        code: 'trigger-filtered',
        details: {reason: expect.any(String)},
      },
    });
    if (filtered.envelope.ok || filtered.envelope.error === undefined) {
      throw new Error('Filtered local workflow did not return an MCP error');
    }
    expect(filtered.envelope.error.details?.reason).toBeTruthy();
  } finally {
    await client.close();
  }
});

async function expectRunIdsToRemain(
  client: Client,
  projectId: string,
  expectedIds: string[],
): Promise<void> {
  let observedSuccessfully = false;
  try {
    const unexpectedIds = await pollUntil(
      {
        timeoutMs: RUN_STABILITY_TIMEOUT_MS,
        intervalMs: 250,
        maxIntervalMs: 250,
        describe: () => 'the project run list to remain unchanged',
      },
      async () => {
        const runIds = (await getRuns(client, projectId)).map(({id}) => id);
        observedSuccessfully = true;
        return runIds.length === expectedIds.length &&
          runIds.every((runId, index) => runId === expectedIds[index])
          ? null
          : runIds;
      },
    );
    throw new Error(
      `A live event unexpectedly changed the project runs: ${unexpectedIds.join(', ')}`,
    );
  } catch (error) {
    if (error instanceof PollTimeoutError && observedSuccessfully) return;
    throw error;
  }
}
