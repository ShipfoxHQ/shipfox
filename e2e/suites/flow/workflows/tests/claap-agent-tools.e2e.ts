import {createApiClient} from '@shipfox/e2e-core';
import {
  type ClaapMockSeed,
  claapMockCalls,
  claapMockMcpRequestCount,
  releaseClaapCall,
  revokeClaapKey,
  seedClaapMock,
  waitForClaapMockCall,
} from '@shipfox/e2e-driver-claap';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {readSuiteContext, type SuiteContext} from '@shipfox/e2e-kit/suite-context';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createClaapConnection} from '@shipfox/e2e-setup-integrations';
import {
  connectionStatus,
  defineIntegrationToolsWorkflow,
  type IntegrationToolsRunner,
  startIntegrationToolsRunner,
} from '#integration-tools.js';
import {expect, test} from './fixtures.js';

const TRANSCRIPT_RECORDING_ID = 'transcriptRec1';
const SUMMARY_RECORDING_ID = 'summaryRec1';
const SUMMARY_RECORDING_TITLE = 'Checkout bug walkthrough';
const TRANSCRIPT_SPEECH = 'Bonjour, le paiement échoue après la remise.';

test.describe.configure({mode: 'serial'});

// One runner serves every test of the spec. The agent test's model script goes into the runner's
// environment, so its connection and script exist before the runner starts.
let shared:
  | {
      suite: SuiteContext;
      runner: IntegrationToolsRunner;
      stopModelProvider: () => Promise<void>;
      transcript: {apiKey: string; claapWorkspaceId: string; connectionSlug: string};
    }
  | undefined;

test.beforeAll(async () => {
  const suite = readSuiteContext();
  const uniqueId = newUniqueId();
  const apiKey = `cla_transcript_${uniqueId}`;
  const {connection, claapWorkspaceId} = await seedClaapConnection({suite, apiKey, uniqueId});
  const shareUrl = recordingUrl({claapWorkspaceId, recordingId: TRANSCRIPT_RECORDING_ID});
  const toolName = `mcp__shipfox__${connection.slug}__get_recording_transcript`;
  const scriptId = `${suite.runId}-claap-${uniqueId}`;
  const fakeModelProvider = await startFakeOpenAiModelProvider({runId: scriptId});
  const stopModelProvider = () => fakeModelProvider.stop().catch(() => undefined);

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId,
      model: 'deterministic-claap-transcript-agent',
      responses: [toolCall(toolName, {recordingUrl: shareUrl}), message('The payment fails.')],
      assertions: [
        {kind: 'tool_present', name: toolName},
        {kind: 'message_content_includes', value: 'échoue', minRequestIndex: 1},
      ],
      setAsDefault: true,
    });
    const runner = await startIntegrationToolsRunner({
      suite,
      name: 'claap',
      uniqueId,
      extraEnv: fakeAnthropic.runnerEnv,
    });
    shared = {
      suite,
      runner,
      stopModelProvider,
      transcript: {apiKey, claapWorkspaceId, connectionSlug: connection.slug},
    };
  } catch (error) {
    await stopModelProvider();
    throw error;
  }
});

test.afterAll(async () => {
  await shared?.runner.stop((name, options) => test.info().attach(name, options));
  await shared?.stopModelProvider();
});

function arranged() {
  if (shared === undefined) throw new Error('The Claap spec setup did not run.');
  return shared;
}

test('an agent reads a transcript from a Claap share URL', async () => {
  const {suite, runner, transcript} = arranged();
  const workflow = await defineIntegrationToolsWorkflow({
    suite,
    runner,
    name: 'claap-transcript',
    uniqueId: newUniqueId(),
    workflowYaml: `
name: Claap agent
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: agent
        harness: claude
        provider: anthropic
        thinking: low
        prompt: Read the Claap recording.
        integrations:
          - connection: ${transcript.connectionSlug}
            include: [get_recording_transcript]
`,
  });

  const terminal = await workflow.run();

  expect(terminal.status).toBe('succeeded');
  // Shipfox reads the recording ID from the URL and sends the connection's workspace.
  expect(await claapMockCalls(transcript.apiKey)).toEqual([
    {
      kind: 'mcp',
      api_key: transcript.apiKey,
      tool_name: 'get_recording_transcript',
      arguments: {
        recordingId: TRANSCRIPT_RECORDING_ID,
        workspaceId: transcript.claapWorkspaceId,
      },
    },
  ]);
});

test('a tool step maps a field from get_recording', async () => {
  const {suite, runner} = arranged();
  const uniqueId = newUniqueId();
  const apiKey = `cla_recording_${uniqueId}`;
  const {connection, claapWorkspaceId} = await seedClaapConnection({suite, apiKey, uniqueId});
  const workflow = await defineIntegrationToolsWorkflow({
    suite,
    runner,
    name: 'claap-recording',
    uniqueId,
    workflowYaml: `
name: Claap recording
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  read:
    steps:
      - key: workspaces
        tool: list_workspaces
        connection: ${connection.slug}
        outputs:
          workspace: '\${{ result.workspaces[0].workspaceId }}'
      - key: recording
        tool: get_recording
        connection: ${connection.slug}
        with:
          recordingId: ${SUMMARY_RECORDING_ID}
        outputs:
          title: '\${{ result.recording.title }}'
          summary: '\${{ result.summary.state }}'
      - key: check
        env:
          CLAAP_WORKSPACE: '\${{ steps.workspaces.outputs.workspace }}'
          CLAAP_TITLE: '\${{ steps.recording.outputs.title }}'
          CLAAP_SUMMARY: '\${{ steps.recording.outputs.summary }}'
        run: |
          test "$CLAAP_WORKSPACE" = "${claapWorkspaceId}"
          test "$CLAAP_TITLE" = "${SUMMARY_RECORDING_TITLE}"
          test "$CLAAP_SUMMARY" = "Ready"
`,
  });

  const terminal = await workflow.run();

  expect(terminal.status).toBe('succeeded');
  expect(terminal.jobs.find((job) => job.key === 'read')?.status).toBe('succeeded');
  // `list_workspaces` is not workspace-scoped, so it goes upstream with no argument.
  expect(await claapMockCalls(apiKey)).toEqual([
    {kind: 'mcp', api_key: apiKey, tool_name: 'list_workspaces', arguments: {}},
    {
      kind: 'mcp',
      api_key: apiKey,
      tool_name: 'get_recording',
      arguments: {recordingId: SUMMARY_RECORDING_ID, workspaceId: claapWorkspaceId},
    },
  ]);
});

test('a revoked key marks the connection and fails the next call fast', async () => {
  const {suite, runner} = arranged();
  const uniqueId = newUniqueId();
  const apiKey = `cla_revoked_${uniqueId}`;
  const {connection} = await seedClaapConnection({suite, apiKey, uniqueId});
  const workflow = await defineIntegrationToolsWorkflow({
    suite,
    runner,
    name: 'claap-revoked',
    uniqueId,
    workflowYaml: claapRecordingToolWorkflow(connection.slug),
  });

  const firstTerminal = await workflow.run();

  expect(firstTerminal.status).toBe('failed');
  expect(await connectionStatus(suite, connection.id)).toBe('error');
  const requestsAfterFirstRun = await claapMockMcpRequestCount(apiKey);
  expect(requestsAfterFirstRun).toBeGreaterThan(0);

  const secondTerminal = await workflow.run();

  expect(secondTerminal.status).toBe('failed');
  expect(await claapMockMcpRequestCount(apiKey)).toBe(requestsAfterFirstRun);
});

test('a replaced key stays active when a call with the old key fails late', async () => {
  const {suite, runner} = arranged();
  const uniqueId = newUniqueId();
  const oldKey = `cla_stale_${uniqueId}`;
  const newKey = `cla_replacement_${uniqueId}`;
  const {connection, claapWorkspaceId} = await seedClaapConnection({
    suite,
    apiKey: oldKey,
    uniqueId,
  });
  // The replacement is checked against the fake, so it must belong to the same Claap workspace.
  await seedClaapMock({apiKey: newKey, seed: claapSeed({claapWorkspaceId, uniqueId})});
  const workflow = await defineIntegrationToolsWorkflow({
    suite,
    runner,
    name: 'claap-stale',
    uniqueId,
    workflowYaml: claapRecordingToolWorkflow(connection.slug),
  });

  // The run waits on the held call while the test replaces the key.
  const running = workflow.run();
  // A step below can throw before anything awaits the run.
  running.catch(() => undefined);

  try {
    await waitForClaapMockCall(oldKey);
    await createApiClient({token: suite.sessionToken}).request(
      'put',
      `/integrations/claap/connections/${connection.id}/api-key`,
      {json: {api_key: newKey}},
    );
    await revokeClaapKey(oldKey);
    await releaseClaapCall(oldKey);

    const terminal = await running;

    expect(terminal.status).toBe('failed');
    expect(await connectionStatus(suite, connection.id)).toBe('active');
  } finally {
    // Releases the held call if a step failed first, so the run ends and frees the runner.
    await revokeClaapKey(oldKey).catch(() => undefined);
    await releaseClaapCall(oldKey).catch(() => undefined);
    await running.catch(() => undefined);
  }
});

function newUniqueId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10);
}

// Claap IDs are letters and digits only, as a share URL needs them.
function recordingUrl({
  claapWorkspaceId,
  recordingId,
}: {
  claapWorkspaceId: string;
  recordingId: string;
}): string {
  return `https://app.claap.io/recording-c-${claapWorkspaceId}-${recordingId}`;
}

/** A Claap workspace of the spec's own, with a recording to read and one with a summary. */
function claapSeed({
  claapWorkspaceId,
  uniqueId,
}: {
  claapWorkspaceId: string;
  uniqueId: string;
}): ClaapMockSeed {
  return {
    workspace: {workspaceId: claapWorkspaceId, name: `Claap flow ${uniqueId}`},
    recordings: [
      {
        recordingId: TRANSCRIPT_RECORDING_ID,
        title: 'Appel client',
        url: recordingUrl({claapWorkspaceId, recordingId: TRANSCRIPT_RECORDING_ID}),
        createdAt: '2026-10-16',
        transcript: [{speaker: 'Noé', text: TRANSCRIPT_SPEECH}],
      },
      {
        recordingId: SUMMARY_RECORDING_ID,
        title: SUMMARY_RECORDING_TITLE,
        url: recordingUrl({claapWorkspaceId, recordingId: SUMMARY_RECORDING_ID}),
        createdAt: '2026-10-16',
        transcript: [{speaker: 'Ada', text: 'The pay button does nothing.'}],
        summary: {markdown: '- The pay button does nothing %[00:00]()', state: 'Ready'},
      },
    ],
  };
}

/**
 * A connection to a Claap workspace of its own, and the fake seeded with it for the key. A
 * Shipfox workspace holds one connection per Claap workspace.
 */
async function seedClaapConnection(params: {
  suite: SuiteContext;
  apiKey: string;
  uniqueId: string;
}) {
  const claapWorkspaceId = `flow${params.uniqueId}`;
  const seed = claapSeed({claapWorkspaceId, uniqueId: params.uniqueId});
  await seedClaapMock({apiKey: params.apiKey, seed});
  const connection = await createClaapConnection({
    workspaceId: params.suite.workspaceId,
    apiKey: params.apiKey,
    claapWorkspaceId,
    claapWorkspaceName: seed.workspace.name,
  });
  return {connection, claapWorkspaceId};
}

function claapRecordingToolWorkflow(connectionSlug: string): string {
  return `
name: Claap recording tool
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  read:
    steps:
      - key: recording
        tool: get_recording
        connection: ${connectionSlug}
        with:
          recordingId: ${SUMMARY_RECORDING_ID}
`;
}
