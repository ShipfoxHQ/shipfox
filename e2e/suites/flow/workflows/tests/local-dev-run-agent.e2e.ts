import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  agentAccessEnvelopeSchema,
  createDevRunResultSchema,
  getTriggerEventResultSchema,
  getWorkflowRunResultSchema,
  getWorkflowRunSourceResultSchema,
  listTriggerEventsResultSchema,
  listWorkflowDefinitionsResultSchema,
  listWorkflowRunsResultSchema,
} from '@shipfox/api-agent-access-dto';
import {config, PollTimeoutError, pollUntil} from '@shipfox/e2e-core';
import {commitFiles} from '@shipfox/e2e-driver-gitea';
import {authorizeAgentAccess} from '@shipfox/e2e-setup-auth';
import {renderWorkflowYaml, seedWorkflowProject} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const EVENT_PAGE_LIMIT = 10;
const MAIN_REF = 'refs/heads/main';
const MCP_POLL_INTERVAL_MS = 5_000;
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

  const apiOrigin = new URL(config.API_URL).origin;
  const publicOrigin = new URL(config.API_PUBLIC_URL).origin;
  const clientOrigin = new URL(config.CLIENT_BASE_URL).origin;
  const token = await authorizeAgentAccess({
    request,
    apiOrigin,
    publicOrigin,
    sessionToken: suite.sessionToken,
    workspaceId: suite.workspaceId,
    clientName: `Local dev run E2E ${uniqueId}`,
    redirectUri: `http://127.0.0.1:43123/${uniqueId}/oauth/callback`,
  });

  const client = new Client({name: 'local-dev-run-agent-e2e-client', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', apiOrigin), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        origin: clientOrigin,
      },
    },
  });

  try {
    await client.connect(transport as unknown as Transport);

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
    const initialEventIds = await listEventIds(client);
    expect(initialEventIds).toContain(sourceEvent.id);

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
    const beforeDryRunEvents = await listEventIds(client);
    expect(beforeDryRun).toHaveLength(0);
    expect(beforeDryRunEvents).toEqual(initialEventIds);

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
    expect(await listEventIds(client)).toEqual(initialEventIds);

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
      excludedIds: new Set(initialEventIds),
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

type McpCall = Awaited<ReturnType<Client['callTool']>>;
type McpEnvelope = ReturnType<typeof agentAccessEnvelopeSchema.parse>;

async function callTool(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<{call: McpCall; envelope: McpEnvelope}> {
  const call = await client.callTool({name, arguments: arguments_}, CallToolResultSchema);
  return {call, envelope: agentAccessEnvelopeSchema.parse(call.structuredContent)};
}

async function getRuns(client: Client, projectId: string) {
  const response = await callTool(client, 'list_workflow_runs', {project_id: projectId});
  if (!response.envelope.ok) throw new Error('Runs list returned an MCP error');
  return listWorkflowRunsResultSchema.parse(response.envelope.result).runs;
}

async function getRun(client: Client, runId: string) {
  const response = await callTool(client, 'get_workflow_run', {run_id: runId});
  if (!response.envelope.ok) throw new Error('Run lookup returned an MCP error');
  return getWorkflowRunResultSchema.parse(response.envelope.result);
}

async function getTriggerEvent(client: Client, eventId: string) {
  const response = await callTool(client, 'get_trigger_event', {event_id: eventId});
  if (!response.envelope.ok) throw new Error('Trigger event lookup returned an MCP error');
  return getTriggerEventResultSchema.parse(response.envelope.result);
}

async function listEventIds(client: Client): Promise<string[]> {
  const response = await callTool(client, 'list_trigger_events', {});
  if (!response.envelope.ok) throw new Error('Trigger event list returned an MCP error');
  return listTriggerEventsResultSchema
    .parse(response.envelope.result)
    .trigger_events.map(({id}) => id)
    .sort();
}

async function waitForIntegrationEvent(params: {
  client: Client;
  source: string;
  event: string;
  repositoryFullName: string;
  after?: string;
  from: string;
  requireProcessed?: boolean;
  description: string;
  excludedIds?: Set<string>;
}) {
  const inspectedIds = new Set<string>();
  return await pollUntil(
    {
      timeoutMs: 60_000,
      intervalMs: MCP_POLL_INTERVAL_MS,
      maxIntervalMs: MCP_POLL_INTERVAL_MS,
      describe: () => params.description,
    },
    async () => {
      const response = await callTool(params.client, 'list_trigger_events', {
        source: [params.source],
        event: [params.event],
        origin: ['integration'],
        from: params.from,
        limit: EVENT_PAGE_LIMIT,
      });
      if (!response.envelope.ok) throw new Error('Trigger event list returned an MCP error');
      const events = listTriggerEventsResultSchema.parse(response.envelope.result).trigger_events;
      return await findMatchingIntegrationEvent({...params, events, inspectedIds});
    },
  );
}

async function findMatchingIntegrationEvent(params: {
  client: Client;
  events: ReturnType<typeof listTriggerEventsResultSchema.parse>['trigger_events'];
  repositoryFullName: string;
  after?: string;
  requireProcessed?: boolean;
  excludedIds?: Set<string>;
  inspectedIds: Set<string>;
}) {
  for (const candidate of params.events) {
    const excluded = params.excludedIds?.has(candidate.id) ?? false;
    if (candidate.origin !== 'integration' || excluded || params.inspectedIds.has(candidate.id)) {
      continue;
    }
    const detail = await getTriggerEvent(params.client, candidate.id);
    if (!triggerEventMatches(detail, params)) {
      params.inspectedIds.add(candidate.id);
      continue;
    }
    if (!params.requireProcessed || detail.processed_at !== null) return detail;
  }
  return null;
}

function triggerEventMatches(
  detail: ReturnType<typeof getTriggerEventResultSchema.parse>,
  params: {repositoryFullName: string; after?: string; requireProcessed?: boolean},
): boolean {
  const payload = JSON.parse(detail.payload_preview) as unknown;
  const repositoryMatches =
    nestedString(payload, ['repository', 'full_name']) === params.repositoryFullName;
  const commitMatches =
    params.after === undefined || nestedString(payload, ['after']) === params.after;
  return repositoryMatches && commitMatches;
}

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

function nestedString(value: unknown, path: string[]): string | undefined {
  let current = value;
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}
