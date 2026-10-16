import {createApiClient, E2eApiError} from '@shipfox/e2e-core';
import {
  jamMockCalls,
  jamMockMcpRequestCount,
  releaseJamCall,
  revokeJamToken,
  waitForJamMockCall,
} from '@shipfox/e2e-driver-jam';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import type {SuiteContext} from '@shipfox/e2e-kit/suite-context';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {
  createAnthropicFakeModelProviderConfig,
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {createJamConnection} from '@shipfox/e2e-setup-integrations';
import {connectionStatus, startIntegrationToolsScenario} from '#integration-tools.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const PI_MODEL = 'deterministic-pi-jam-agent';

// The two Jams the fake holds, the ones of the contracts sandbox.
const VIDEO_JAM_ID = '4ea19ea4-b021-474f-b254-5df55d37d702';
const VIDEO_JAM_LINK = `https://jam.dev/c/${VIDEO_JAM_ID}`;
const SCREENSHOT_JAM_ID = '64bc4070-8ada-45a6-a15d-f60851f85ddd';
const VIDEO_JAM_TITLE = "Checkout: Pay button fails with 'Something went wrong'";
// The Jam workspace and user that the fake's introspection returns for a live token. A replacement
// token must belong to them, or Shipfox refuses it as another workspace's.
const FAKE_TEAM_ID = 'bf9da890-a8ce-4cf6-8627-1e352ddba3c8';
const FAKE_USER_ID = '2b87c817-d4da-47fa-937a-43cf758ace42';

test.describe.configure({mode: 'serial'});

interface TestInfo {
  attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
}

test('an agent reads the console logs of a Jam from its link', async ({suite}, testInfo) => {
  const uniqueId = newUniqueId();
  const token = `jam_pat_console_${uniqueId}`;
  const connection = await seedJamConnection({suite, token, uniqueId});
  const toolName = `mcp__shipfox__${connection.slug}__getConsoleLogs`;
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-jam-console-${uniqueId}`,
  });

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-jam-console-${uniqueId}`,
      model: 'deterministic-jam-console-agent',
      responses: [
        toolCall(toolName, {jamId: VIDEO_JAM_LINK, logLevel: ['error']}),
        message('The checkout fails with coupon_lookup_failed.'),
      ],
      assertions: [
        {kind: 'tool_present', name: toolName},
        {kind: 'message_content_includes', value: 'coupon_lookup_failed', minRequestIndex: 1},
      ],
      setAsDefault: true,
    });
    const scenario = await startIntegrationToolsScenario({
      suite,
      testInfo,
      uniqueId,
      name: 'jam-console',
      workflowYaml: jamAgentWorkflow({
        connectionSlug: connection.slug,
        harness: 'claude',
        tools: ['getDetails', 'getConsoleLogs'],
      }),
      extraEnv: fakeAnthropic.runnerEnv,
    });

    try {
      const terminal = await scenario.run();

      expect(terminal.status).toBe('succeeded');
      expect(await jamMockCalls(token)).toEqual([
        {
          kind: 'mcp',
          token,
          tool_name: 'getConsoleLogs',
          arguments: {jamId: VIDEO_JAM_LINK, logLevel: ['error']},
        },
      ]);
    } finally {
      await scenario.stop();
    }
  } finally {
    await fakeModelProvider.stop().catch(() => undefined);
  }
});

test('a Claude agent receives the image block of getScreenshots', async ({suite}, testInfo) => {
  const uniqueId = newUniqueId();
  const token = `jam_pat_claude_image_${uniqueId}`;
  const connection = await seedJamConnection({suite, token, uniqueId});
  const toolName = `mcp__shipfox__${connection.slug}__getScreenshots`;
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-jam-claude-image-${uniqueId}`,
  });

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-jam-claude-image-${uniqueId}`,
      model: 'deterministic-jam-claude-image-agent',
      responses: [
        toolCall(toolName, {jamId: SCREENSHOT_JAM_ID}),
        message('The screenshot shows the checkout error.'),
      ],
      assertions: [
        {kind: 'tool_present', name: toolName},
        {kind: 'image_content_present', minRequestIndex: 1},
      ],
      setAsDefault: true,
    });
    const scenario = await startIntegrationToolsScenario({
      suite,
      testInfo,
      uniqueId,
      name: 'jam-claude-image',
      workflowYaml: jamAgentWorkflow({
        connectionSlug: connection.slug,
        harness: 'claude',
        tools: ['getScreenshots'],
      }),
      extraEnv: fakeAnthropic.runnerEnv,
    });

    try {
      const terminal = await scenario.run();
      await attachModelRequests({
        fakeModelProvider,
        scriptId: `${suite.runId}-jam-claude-image-${uniqueId}`,
        terminal,
        testInfo,
      });

      expect(terminal.status).toBe('succeeded');
      expect((await jamMockCalls(token)).map((call) => call.tool_name)).toEqual(['getScreenshots']);
    } finally {
      await scenario.stop();
    }
  } finally {
    await fakeModelProvider.stop().catch(() => undefined);
  }
});

test('a Claude agent receives the image blocks of getFrames', async ({suite}, testInfo) => {
  const uniqueId = newUniqueId();
  const token = `jam_pat_claude_frames_${uniqueId}`;
  const connection = await seedJamConnection({suite, token, uniqueId});
  const toolName = `mcp__shipfox__${connection.slug}__getFrames`;
  const scriptId = `${suite.runId}-jam-claude-frames-${uniqueId}`;
  const fakeModelProvider = await startFakeOpenAiModelProvider({runId: scriptId});

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId,
      model: 'deterministic-jam-claude-frames-agent',
      responses: [
        toolCall(toolName, {jamId: VIDEO_JAM_LINK, fromMs: 0, toMs: 9000, count: 3}),
        message('The pay button does nothing.'),
      ],
      assertions: [
        {kind: 'tool_present', name: toolName},
        {kind: 'message_content_includes', value: 't=4500ms', minRequestIndex: 1},
        {kind: 'image_content_present', minRequestIndex: 1},
      ],
      setAsDefault: true,
    });
    const scenario = await startIntegrationToolsScenario({
      suite,
      testInfo,
      uniqueId,
      name: 'jam-claude-frames',
      workflowYaml: jamAgentWorkflow({
        connectionSlug: connection.slug,
        harness: 'claude',
        tools: ['getFrames'],
      }),
      extraEnv: fakeAnthropic.runnerEnv,
    });

    try {
      const terminal = await scenario.run();
      await attachModelRequests({fakeModelProvider, scriptId, terminal, testInfo});

      expect(terminal.status).toBe('succeeded');
      expect(await jamMockCalls(token)).toEqual([
        {
          kind: 'mcp',
          token,
          tool_name: 'getFrames',
          arguments: {jamId: VIDEO_JAM_LINK, fromMs: 0, toMs: 9000, count: 3},
        },
      ]);
    } finally {
      await scenario.stop();
    }
  } finally {
    await fakeModelProvider.stop().catch(() => undefined);
  }
});

test('a Pi agent receives the image block of getScreenshots', async ({suite}, testInfo) => {
  const uniqueId = newUniqueId();
  const token = `jam_pat_pi_image_${uniqueId}`;
  const connection = await seedJamConnection({suite, token, uniqueId});
  const scriptId = `${suite.runId}-jam-pi-image-${uniqueId}`;
  const fakeModelProvider = await startFakeOpenAiModelProvider({runId: scriptId});
  let providerId: string | undefined;

  try {
    const toolName = `${connection.slug}__getScreenshots`;
    const script = await fakeModelProvider.createScript({
      id: scriptId,
      model: PI_MODEL,
      // The first request is the provider probe.
      responses: [
        message('provider probe ok'),
        toolCall(toolName, {jamId: SCREENSHOT_JAM_ID}),
        message('The screenshot shows the checkout error.'),
      ],
      assertions: [
        {kind: 'model', equals: PI_MODEL},
        {kind: 'tool_present', name: toolName, minRequestIndex: 1},
        {kind: 'image_content_present', minRequestIndex: 2},
      ],
    });
    const provider = await createOpenAiCompatibleCustomProvider({
      workspaceId: suite.workspaceId,
      sessionToken: suite.sessionToken,
      providerId: `fake-pi-jam-image-${uniqueId}`,
      displayName: `Fake Pi Jam image ${uniqueId}`,
      baseUrl: script.modelProviderBaseUrl,
      model: script.model,
      // Pi drops the images from a request to a model that doesn't declare image input.
      modelMetadata: {input_image: true},
    });
    providerId = provider.provider_id;
    const scenario = await startIntegrationToolsScenario({
      suite,
      testInfo,
      uniqueId,
      name: 'jam-pi-image',
      workflowYaml: jamAgentWorkflow({
        connectionSlug: connection.slug,
        harness: 'pi',
        provider: provider.provider_id,
        model: script.model,
        tools: ['getScreenshots'],
      }),
    });

    try {
      const terminal = await scenario.run();
      await attachModelRequests({fakeModelProvider, scriptId, terminal, testInfo});

      expect(terminal.status).toBe('succeeded');
      expect((await jamMockCalls(token)).map((call) => call.tool_name)).toEqual(['getScreenshots']);
    } finally {
      await scenario.stop();
    }
  } finally {
    if (providerId !== undefined) {
      await deleteModelProviderConfig({
        workspaceId: suite.workspaceId,
        sessionToken: suite.sessionToken,
        providerId,
      }).catch(() => undefined);
    }
    await fakeModelProvider.stop().catch(() => undefined);
  }
});

test('a tool step maps a field from getDetails', async ({suite}, testInfo) => {
  const uniqueId = newUniqueId();
  const token = `jam_pat_details_${uniqueId}`;
  const connection = await seedJamConnection({suite, token, uniqueId});
  const scenario = await startIntegrationToolsScenario({
    suite,
    testInfo,
    uniqueId,
    name: 'jam-details',
    workflowYaml: `
name: Jam details
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  read:
    steps:
      - key: details
        tool: getDetails
        connection: ${connection.slug}
        with:
          jamId: ${VIDEO_JAM_LINK}
        outputs:
          title: '\${{ result.title }}'
          team: '\${{ result.teamId }}'
      - key: check
        env:
          JAM_TITLE: '\${{ steps.details.outputs.title }}'
          JAM_TEAM: '\${{ steps.details.outputs.team }}'
        run: |
          test "$JAM_TITLE" = "${VIDEO_JAM_TITLE}"
          test "$JAM_TEAM" = "${FAKE_TEAM_ID}"
`,
  });

  try {
    const terminal = await scenario.run();

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'read')?.status).toBe('succeeded');
    expect(await jamMockCalls(token)).toEqual([
      {kind: 'mcp', token, tool_name: 'getDetails', arguments: {jamId: VIDEO_JAM_LINK}},
    ]);
  } finally {
    await scenario.stop();
  }
});

test('refuses a tool step that calls getFrames when its definition is created', async ({suite}) => {
  const uniqueId = newUniqueId();
  const token = `jam_pat_frames_${uniqueId}`;
  const connection = await seedJamConnection({suite, token, uniqueId});

  // getFrames returns images, which a tool step never reads, so the definition fails before any run.
  const refusal = await seedProjectWithApiDefinition({
    suite,
    token: suite.sessionToken,
    name: 'jam-frames',
    repo: `jam-frames-${uniqueId}`,
    runnerLabel: `e2e-jam-frames-${uniqueId}`,
    workflowYaml: `
name: Jam frames
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  read:
    steps:
      - key: frames
        tool: getFrames
        connection: ${connection.slug}
        with:
          jamId: ${VIDEO_JAM_ID}
          overview: true
`,
    configPath: '.shipfox/workflows/jam-frames.yml',
  }).then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(refusal).toBeInstanceOf(E2eApiError);
  expect((refusal as E2eApiError).status).toBe(400);
  expect(JSON.stringify((refusal as E2eApiError).details)).toContain(
    'Integration tool getFrames returns images',
  );
  expect(await jamMockCalls(token)).toEqual([]);
});

test('a revoked token marks the connection and fails the next call fast', async ({
  suite,
}, testInfo) => {
  const uniqueId = newUniqueId();
  const token = `jam_pat_revoked_${uniqueId}`;
  const connection = await seedJamConnection({suite, token, uniqueId});
  const scenario = await startIntegrationToolsScenario({
    suite,
    testInfo,
    uniqueId,
    name: 'jam-revoked',
    workflowYaml: jamDetailsToolWorkflow(connection.slug),
  });

  try {
    const firstTerminal = await scenario.run();

    expect(firstTerminal.status).toBe('failed');
    expect(await connectionStatus(suite, connection.id)).toBe('error');
    const requestsAfterFirstRun = await jamMockMcpRequestCount(token);
    expect(requestsAfterFirstRun).toBeGreaterThan(0);

    const secondTerminal = await scenario.run();

    expect(secondTerminal.status).toBe('failed');
    expect(await jamMockMcpRequestCount(token)).toBe(requestsAfterFirstRun);
  } finally {
    await scenario.stop();
  }
});

test('a replaced token stays active when a call with the old token fails late', async ({
  suite,
}, testInfo) => {
  const uniqueId = newUniqueId();
  const oldToken = `jam_pat_stale_${uniqueId}`;
  const newToken = `jam_pat_replacement_${uniqueId}`;
  // The replacement is validated against the fake, so the connection holds its Jam workspace.
  const connection = await seedJamConnection({
    suite,
    token: oldToken,
    uniqueId,
    identity: {teamId: FAKE_TEAM_ID, userId: FAKE_USER_ID},
  });
  const scenario = await startIntegrationToolsScenario({
    suite,
    testInfo,
    uniqueId,
    name: 'jam-stale',
    workflowYaml: jamDetailsToolWorkflow(connection.slug),
  });

  // The run waits on the held call while the test replaces the token.
  const running = scenario.run();
  // A step below can throw before anything awaits the run.
  running.catch(() => undefined);

  try {
    await waitForJamMockCall(oldToken);
    await createApiClient({token: suite.sessionToken}).request(
      'put',
      `/integrations/jam/connections/${connection.id}/token`,
      {json: {token: newToken}},
    );
    await revokeJamToken(oldToken);
    await releaseJamCall(oldToken);

    const terminal = await running;

    expect(terminal.status).toBe('failed');
    expect(await connectionStatus(suite, connection.id)).toBe('active');
  } finally {
    // Releases the held call if a step failed first, so the run ends and the runner can stop.
    await revokeJamToken(oldToken).catch(() => undefined);
    await releaseJamCall(oldToken).catch(() => undefined);
    await running.catch(() => undefined);
    await scenario.stop();
  }
});

function newUniqueId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10);
}

async function seedJamConnection(params: {
  suite: SuiteContext;
  token: string;
  uniqueId: string;
  identity?: {teamId: string; userId: string} | undefined;
}) {
  const identity = params.identity ?? {
    teamId: `jam-team-${params.uniqueId}`,
    userId: `jam-user-${params.uniqueId}`,
  };
  return await createJamConnection({
    workspaceId: params.suite.workspaceId,
    token: params.token,
    teamId: identity.teamId,
    userId: identity.userId,
    userName: `Jam flow ${params.uniqueId}`,
    userEmail: `jam-flow-${params.uniqueId}@example.com`,
  });
}

async function attachModelRequests(params: {
  fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>>;
  scriptId: string;
  terminal: WorkflowRunObservation;
  testInfo: TestInfo;
}): Promise<void> {
  if (params.terminal.status === 'succeeded') return;
  const requests = await params.fakeModelProvider.getRequests(params.scriptId);
  await params.testInfo.attach('jam-model-requests.json', {
    body: JSON.stringify(requests, null, 2),
    contentType: 'application/json',
  });
}

function jamAgentWorkflow(params: {
  connectionSlug: string;
  harness: 'claude' | 'pi';
  provider?: string | undefined;
  model?: string | undefined;
  tools: string[];
}): string {
  const model =
    params.harness === 'claude'
      ? `        provider: anthropic
        thinking: low`
      : `        provider: ${params.provider}
        model: ${params.model}
        thinking: off`;
  return `
name: Jam agent
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: agent
        harness: ${params.harness}
${model}
        prompt: Investigate the Jam.
        integrations:
          - connection: ${params.connectionSlug}
            include: [${params.tools.join(', ')}]
`;
}

function jamDetailsToolWorkflow(connectionSlug: string): string {
  return `
name: Jam details tool
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  read:
    steps:
      - key: details
        tool: getDetails
        connection: ${connectionSlug}
        with:
          jamId: ${VIDEO_JAM_ID}
`;
}
