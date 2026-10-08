import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApiClient} from '@shipfox/e2e-core';
import {getFileSha} from '@shipfox/e2e-driver-gitea';
import {
  deployRunner,
  localRunnerLogTail,
  publishJobContainerImage,
  removePublishedJobContainerImage,
  stopLocalRunner,
} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import type {WorkflowRunObservation, WorkflowStepObservation} from '@shipfox/e2e-observe-workflows';
import {logText} from '#expect.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition, type WorkflowProjectFile} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const RUN_TIMEOUT_MS = 240_000;
const NAME = 'job-container';
const JOB_KEY = 'toolbox';
const STEP_KEYS = ['image-tool', 'probe', 'sibling', 'push'] as const;
const PUSHED_FILE = 'pushed-from-container.txt';
const TOOLBOX_CONTEXT = fileURLToPath(new URL('../fixtures/container-toolbox/', import.meta.url));

const workflowYaml = `
name: Job container
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  ${JOB_KEY}:
    container: __CONTAINER_IMAGE__
    checkout:
      permissions:
        contents: write
    steps:
      - key: image-tool
        name: Call an executable that only the image has
        run: shipfox-e2e-toolbox
      - key: probe
        name: Set an output from an action
        uses: ./.shipfox/actions/probe
      - key: sibling
        name: Mount the workspace in a sibling container
        env:
          TOOLBOX: \${{ steps.probe.outputs.toolbox }}
        run: |
          test "$TOOLBOX" = "found"
          docker run --rm -v "$PWD:/src" busybox ls /src/.shipfox/actions/probe
      - key: push
        name: Push a commit
        run: |
          git config --local commit.gpgsign false
          echo "pushed from the job container" > ${PUSHED_FILE}
          git add ${PUSHED_FILE}
          git commit -m "push from the job container"
          git push origin HEAD:main
`;

const probeAction: WorkflowProjectFile[] = [
  {
    path: '.shipfox/actions/probe/action.yml',
    content: `name: Toolbox probe
description: Reports whether the action process sees the executable of the job image.
main: index.ts
outputs:
  toolbox:
    required: true
`,
  },
  {
    path: '.shipfox/actions/probe/index.ts',
    content: `import {existsSync} from 'node:fs';
import {defineAction} from '@shipfox/actions';

export default defineAction(() => ({
  toolbox: existsSync('/usr/local/bin/shipfox-e2e-toolbox') ? 'found' : 'missing',
}));
`,
  },
];

function jobSteps(observation: WorkflowRunObservation): WorkflowStepObservation[] {
  return (
    observation.jobs
      .find((job) => job.key === JOB_KEY)
      ?.executions.flatMap((execution) => execution.steps) ?? []
  );
}

async function stepLogs(params: {
  observation: WorkflowRunObservation;
  stepKey: string;
  token: string;
}): Promise<string> {
  const step = jobSteps(params.observation).find((candidate) => candidate.key === params.stepKey);
  if (step === undefined) throw new Error(`Step ${JOB_KEY}.${params.stepKey} is missing`);
  const logs = await fetchStepLogs({
    stepId: step.id,
    attempt: step.current_attempt,
    token: params.token,
  });
  return logText(logs.records);
}

test('a container job runs run steps, an action, sibling containers, and a Git push', async ({
  suite,
}) => {
  // The job container runs the Node binary of the runner, so the runner host must be
  // Linux. CI is; a macOS or Windows development machine is not.
  test.skip(process.platform !== 'linux', 'Job containers need a Linux runner host.');
  // The arrangement builds an image and deploys the runner before the run starts.
  test.slow();

  const token = suite.sessionToken;
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-${NAME}-${uniqueId}`;
  const repo = `${NAME}-${uniqueId}`;
  // Outside the repository: a deployed package there would join the pnpm workspace.
  const installParent = await mkdtemp(join(tmpdir(), 'shipfox-e2e-runner-install-'));
  const installDir = join(installParent, 'runner');

  const publishing = publishJobContainerImage({
    contextDir: TOOLBOX_CONTEXT,
    name: 'shipfox-e2e/container-toolbox',
    uniqueId,
  });
  try {
    const [published] = await Promise.all([publishing, deployRunner({installDir})]);
    const localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: token,
      name: `E2E ${NAME} ${uniqueId}`,
      runnerLabel,
      installDir,
    });
    try {
      // Only a definition sync snapshots actions, so the definition comes from the repository.
      const seeded = await seedAndWaitForDefinition({
        suite,
        token,
        name: NAME,
        repo,
        runnerLabel,
        workflowYaml,
        configPath: `.shipfox/workflows/${NAME}.yml`,
        replacements: {__CONTAINER_IMAGE__: published.image},
        extraFiles: probeAction,
      });
      const runId = await fireManualAndAwaitRun({
        client: createApiClient({token}),
        definitionId: seeded.definition.id,
        inputs: {},
        scenario: NAME,
      });

      const observation = await waitForRunTerminalOrFailedRunner({
        runId,
        token,
        timeoutMs: RUN_TIMEOUT_MS,
        runner: localRunner.runner,
        selection: {
          jobs: [{jobKey: JOB_KEY, includeDefaultExecution: true, stepKeys: [...STEP_KEYS]}],
        },
      });

      // A step that never started has no logs, so the statuses are checked first.
      const statuses = jobSteps(observation).map(({key, status, error}) => ({key, status, error}));
      expect(
        observation.status,
        `${JSON.stringify(statuses, null, 2)}${localRunnerLogTail(localRunner.logFile)}`,
      ).toBe('succeeded');
      const logs = {
        imageTool: await stepLogs({observation, stepKey: 'image-tool', token}),
        sibling: await stepLogs({observation, stepKey: 'sibling', token}),
      };
      expect(logs.imageTool).toContain('shipfox-e2e-toolbox ran in the job container');
      expect(logs.sibling).toContain('action.yml');
      await expect(getFileSha({org: suite.org, repo, path: PUSHED_FILE})).resolves.toEqual(
        expect.any(String),
      );
    } finally {
      await stopLocalRunner(localRunner.runner).catch(() => undefined);
    }
  } finally {
    const published = await publishing.catch(() => undefined);
    if (published !== undefined) await removePublishedJobContainerImage(published);
    await rm(installParent, {recursive: true, force: true});
  }
});
