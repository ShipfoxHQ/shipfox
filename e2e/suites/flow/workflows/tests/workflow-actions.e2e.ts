import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {commitFiles, getFileSha} from '@shipfox/e2e-driver-gitea';
import {type LocalRunnerHandle, stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs, waitForStepLogsContaining} from '@shipfox/e2e-observe-logs';
import {
  observeRun,
  type WorkflowRunObservation,
  type WorkflowStepObservation,
  waitForRunByCommit,
} from '@shipfox/e2e-observe-workflows';
import {logText} from '#expect.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition, type WorkflowProjectFile} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

// Scenarios that need more than one run, a second commit, or a call from outside the run.
// The single-run action cases are declarative scenarios under scenarios/action-*.

const RUN_TIMEOUT_MS = 180_000;
const ACTION_DIR = '.shipfox/actions/version';
const VERSION_FILE = `${ACTION_DIR}/version.ts`;
const DIGEST_RE = /Shipfox action Version (sha256:[0-9a-f]{64})/u;
const MODEL_DIGEST_RE = /sha256:[0-9a-f]{64}/u;

const versionAction = (version: string): WorkflowProjectFile[] => [
  {
    path: `${ACTION_DIR}/action.yml`,
    content: `name: Version
description: Reports the version of its own code and of the checked-out copy.
main: index.ts
outputs:
  code:
    required: true
`,
  },
  {
    path: `${ACTION_DIR}/index.ts`,
    content: `import {readFileSync} from 'node:fs';
import {defineAction} from '@shipfox/actions';
import {VERSION} from './version.ts';

export default defineAction(({log}) => {
  log.info(\`action code: \${VERSION}\`);
  log.info(\`checkout: \${readFileSync('${VERSION_FILE}', 'utf8').trim()}\`);
  return {code: VERSION};
});
`,
  },
  versionFile(version),
];

function versionFile(version: string): WorkflowProjectFile {
  return {path: VERSION_FILE, content: `export const VERSION = '${version}';\n`};
}

interface ActionProject {
  client: ReturnType<typeof createApiClient>;
  configPath: string;
  definitionId: string;
  projectId: string;
  repo: string;
  runner: LocalRunnerHandle;
}

async function withActionProject(
  params: {suite: SuiteContext; name: string; workflowYaml: string; files: WorkflowProjectFile[]},
  body: (project: ActionProject) => Promise<void>,
): Promise<void> {
  const token = params.suite.sessionToken;
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-${params.name}-${uniqueId}`;
  const repo = `${params.name}-${uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${params.name} ${uniqueId}`,
    runnerLabel,
  });
  const configPath = `.shipfox/workflows/${params.name}.yml`;
  try {
    // Only a definition sync snapshots actions, so these definitions come from the repository.
    const seeded = await seedAndWaitForDefinition({
      suite: params.suite,
      token,
      name: params.name,
      repo,
      runnerLabel,
      workflowYaml: params.workflowYaml,
      configPath,
      extraFiles: params.files,
    });
    await body({
      client: createApiClient({token}),
      configPath,
      definitionId: seeded.definition.id,
      projectId: seeded.project.id,
      repo,
      runner: localRunner.runner,
    });
  } finally {
    await stopLocalRunner(localRunner.runner).catch(() => undefined);
  }
}

function findStep(
  observation: WorkflowRunObservation,
  jobKey: string,
  stepKey: string,
): WorkflowStepObservation {
  const step = observation.jobs
    .find((job) => job.key === jobKey)
    ?.executions.flatMap((execution) => execution.steps)
    .find((candidate) => candidate.key === stepKey);
  if (step === undefined) throw new Error(`Step ${jobKey}.${stepKey} is missing`);
  return step;
}

async function stepLogText(params: {step: WorkflowStepObservation; token: string}) {
  const logs = await fetchStepLogs({
    stepId: params.step.id,
    attempt: params.step.current_attempt,
    token: params.token,
  });
  return logText(logs.records);
}

async function runVersionStep(params: {
  project: ActionProject;
  runId: string;
  token: string;
}): Promise<{observation: WorkflowRunObservation; logs: string; digest: string | undefined}> {
  const observation = await waitForRunTerminalOrFailedRunner({
    runId: params.runId,
    token: params.token,
    timeoutMs: RUN_TIMEOUT_MS,
    runner: params.project.runner,
    selection: {jobs: [{jobKey: 'build', includeDefaultExecution: true, stepKeys: ['version']}]},
  });
  const logs = await stepLogText({
    step: findStep(observation, 'build', 'version'),
    token: params.token,
  });
  return {observation, logs, digest: DIGEST_RE.exec(logs)?.[1]};
}

test('a branch push runs the default-branch snapshot of an action', async ({suite}) => {
  const token = suite.sessionToken;
  const workflowYaml = `
name: Action snapshot source
runner: __RUNNER_LABEL__
triggers:
  on_push:
    source: __GITEA_SOURCE__
    event: push
    filter: 'event.ref == "refs/heads/feature" && event.repository.full_name == "__GITEA_REPOSITORY__"'
jobs:
  build:
    steps:
      - key: version
        uses: ./${ACTION_DIR}
`;

  await withActionProject(
    {suite, name: 'action-snapshot-source', workflowYaml, files: versionAction('main')},
    async (project) => {
      // The branch rewrites the action. The run checks the branch out, but the action code
      // must come from the snapshot of the default branch.
      const branchSha = await commitFiles({
        org: suite.org,
        repo: project.repo,
        message: 'change the action on a branch',
        branch: 'main',
        newBranch: 'feature',
        files: [
          {
            ...versionFile('feature'),
            operation: 'update',
            sha: await getFileSha({org: suite.org, repo: project.repo, path: VERSION_FILE}),
          },
        ],
      });
      const run = await waitForRunByCommit({
        projectId: project.projectId,
        headCommitSha: branchSha,
        token,
        timeoutMs: 60_000,
      });

      const {observation, logs} = await runVersionStep({project, runId: run.id, token});

      expect(observation.status).toBe('succeeded');
      expect(logs).toContain('action code: main');
      expect(logs).toContain("checkout: export const VERSION = 'feature';");
      expect(logs).not.toContain('action code: feature');
    },
  );
});

test('an action-only commit makes a new definition version and reruns keep their snapshot', async ({
  suite,
}) => {
  // Three runs, each with its own terminal budget.
  test.slow();
  const token = suite.sessionToken;
  const workflowYaml = `
name: Action snapshot versions
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  build:
    steps:
      - key: version
        uses: ./${ACTION_DIR}
`;

  await withActionProject(
    {suite, name: 'action-snapshot-versions', workflowYaml, files: versionAction('v1')},
    async (project) => {
      const firstRunId = await fireManualAndAwaitRun({
        client: project.client,
        definitionId: project.definitionId,
        inputs: {},
        scenario: project.repo,
      });
      const first = await runVersionStep({project, runId: firstRunId, token});
      expect(first.observation.status).toBe('succeeded');
      expect(first.logs).toContain('action code: v1');
      expect(first.digest).toBeDefined();

      await commitFiles({
        org: suite.org,
        repo: project.repo,
        message: 'change only the action',
        files: [
          {
            ...versionFile('v2'),
            operation: 'update',
            sha: await getFileSha({org: suite.org, repo: project.repo, path: VERSION_FILE}),
          },
        ],
      });
      // VCS definitions are versioned by content, not by commit: the new version is the
      // same definition whose model now pins another action snapshot.
      const updated = await pollUntil(
        {
          timeoutMs: 60_000,
          intervalMs: 250,
          maxIntervalMs: 2_000,
          backoffFactor: 1.5,
          describe: () => `definition ${project.configPath} to leave digest ${first.digest}`,
        },
        async () => {
          const query = new URLSearchParams({project_id: project.projectId});
          const response = await project.client.requestJson<DefinitionListResponseDto>(
            'get',
            `/definitions?${query}`,
          );
          const definition = response.definitions.find(
            (item) => item.config_path === project.configPath,
          );
          const digest = MODEL_DIGEST_RE.exec(JSON.stringify(definition?.workflow_model))?.[0];
          return definition !== undefined && digest !== undefined && digest !== first.digest
            ? {definition, digest}
            : null;
        },
      );

      const secondRunId = await fireManualAndAwaitRun({
        client: project.client,
        definitionId: updated.definition.id,
        inputs: {},
        scenario: project.repo,
      });
      const second = await runVersionStep({project, runId: secondRunId, token});
      expect(second.observation.status).toBe('succeeded');
      expect(second.logs).toContain('action code: v2');
      expect(second.digest).toBe(updated.digest);

      await project.client.requestJson(
        'post',
        `/workflows/runs/${encodeURIComponent(firstRunId)}/rerun`,
        {json: {mode: 'all'}},
      );
      const rerun = await runVersionStep({project, runId: firstRunId, token});
      expect(rerun.observation).toMatchObject({status: 'succeeded', current_attempt: 2});
      expect(rerun.logs).toContain('action code: v1');
      expect(rerun.digest).toBe(first.digest);
    },
  );
});

test('cancelling a run stops an action in the middle of its tool calls', async ({suite}) => {
  const token = suite.sessionToken;
  const workflowYaml = `
name: Action cancellation
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  build:
    steps:
      - key: poll
        uses: ./.shipfox/actions/poll
        connections:
          shipfox: shipfox
`;
  const files: WorkflowProjectFile[] = [
    {
      path: '.shipfox/actions/poll/action.yml',
      content: `name: Poll
description: Reads its own run until the step is cancelled.
main: index.ts
integrations:
  shipfox:
    provider: shipfox
    include: [get_workflow_run]
`,
    },
    {
      path: '.shipfox/actions/poll/index.ts',
      content: `import {defineAction} from '@shipfox/actions';

export default defineAction(async ({tools, context, log, signal}) => {
  let calls = 0;
  while (true) {
    await tools.shipfox.call('get_workflow_run', {run_id: context.runId}, {signal});
    calls += 1;
    if (calls === 1) log.info('first tool call returned');
  }
});
`,
    },
  ];

  await withActionProject(
    {suite, name: 'action-cancellation', workflowYaml, files},
    async (project) => {
      const runId = await fireManualAndAwaitRun({
        client: project.client,
        definitionId: project.definitionId,
        inputs: {},
        scenario: project.repo,
      });
      const selection = {
        jobs: [{jobKey: 'build', includeDefaultExecution: true, stepKeys: ['poll']}],
      };
      const running = await pollUntil(
        {
          timeoutMs: RUN_TIMEOUT_MS,
          intervalMs: 250,
          maxIntervalMs: 2_000,
          backoffFactor: 1.5,
          describe: () => `poll step running in run ${runId}`,
        },
        async () => {
          const observation = await observeRun({runId, token, selection});
          const step = observation.jobs
            .find((job) => job.key === 'build')
            ?.executions.flatMap((execution) => execution.steps)
            .find((candidate) => candidate.key === 'poll');
          return step?.status === 'running' ? step : null;
        },
      );
      await waitForStepLogsContaining({
        stepId: running.id,
        attempt: running.current_attempt,
        expectedText: 'first tool call returned',
        token,
        timeoutMs: 60_000,
      });

      await project.client.request('post', `/workflows/runs/${encodeURIComponent(runId)}/cancel`);

      const observation = await waitForRunTerminalOrFailedRunner({
        runId,
        token,
        timeoutMs: RUN_TIMEOUT_MS,
        runner: project.runner,
        selection,
      });
      expect(observation.status).toBe('cancelled');
      expect(findStep(observation, 'build', 'poll').status).toBe('cancelled');
      // The runner outlives the cancelled action.
      expect(project.runner.process.exitCode).toBeNull();
    },
  );
});
