import {rm} from 'node:fs/promises';
import {createDevRunResultSchema} from '@shipfox/api-agent-access-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {waitForDefinition} from '@shipfox/e2e-observe-definitions';
import type {WorkflowRunObservation, WorkflowStepObservation} from '@shipfox/e2e-observe-workflows';
import {callTool, connectAgentAccessMcp} from '#agent-access-mcp.js';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {type ReferenceActionName, referenceActionFiles} from '#reference-actions.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

// The cache actions, run as a user would: synced from the repository, then from a dev run, on a
// local runner that talks to the API and to Garage. The synced workflow saves from one working
// directory and home and restores into others, so the entry has to move between checkouts.

const RUN_TIMEOUT_MS = 180_000;
const ACTIONS: ReferenceActionName[] = ['cache-restore', 'cache-save'];
const DEV_CONFIG_PATH = '.shipfox/workflows/cache-dev.yml';

// Two locks, so one key_files hash misses against the entry saved under the other.
const LOCK_V1 = 'lock v1';
const LOCK_V2 = 'lock v2';

test('the cache actions save and restore across jobs, checkouts, homes, and dev runs', async ({
  request,
  suite,
}, testInfo) => {
  test.setTimeout(540_000);
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const name = `cache-${uniqueId}`;
  const runnerLabel = `e2e-${name}`;
  const homeRoot = `/tmp/shipfox-cache-e2e-${uniqueId}`;
  const token = suite.sessionToken;
  const devOnlyKey = `dev-only-${uniqueId}`;
  const raceKey = `race-${uniqueId}`;
  // The key prefix is unique per test, so a rerun never meets entries of an earlier one.
  const depsKey = `deps-${uniqueId}`;
  const hashKey = `hash-${uniqueId}`;

  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${name}`,
    runnerLabel,
  });
  const client = await connectAgentAccessMcp({
    request,
    suite,
    uniqueId,
    clientName: 'Cache actions',
  });

  const attachLogs = async (observation: WorkflowRunObservation) => {
    for (const logRequest of collectStepLogAttachmentRequests(observation)) {
      const attachment = await fetchLogAttachment(logRequest, token);
      await testInfo.attach(attachment.name, {
        body: attachment.body,
        contentType: attachment.contentType,
      });
    }
  };
  const awaitRun = async (runId: string, jobs: Record<string, string[]>) => {
    const observation = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: RUN_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: Object.entries(jobs).map(([jobKey, stepKeys]) => ({
          jobKey,
          includeDefaultExecution: true,
          stepKeys,
        })),
      },
    });
    await attachLogs(observation);
    return observation;
  };

  try {
    const actionFiles = (await Promise.all(ACTIONS.map(referenceActionFiles))).flat();
    const seeded = await seedAndWaitForDefinition({
      suite,
      token,
      name,
      repo: name,
      runnerLabel,
      workflowYaml: synced({runnerLabel, homeRoot, depsKey, raceKey, hashKey}),
      configPath: `.shipfox/workflows/${name}.yml`,
      extraFiles: [
        ...actionFiles,
        {
          path: '.shipfox/workflows/cache-probe.yml',
          content: probe({runnerLabel, key: devOnlyKey}),
        },
      ],
    });
    const probeDefinition = await waitForDefinition({
      projectId: seeded.project.id,
      configPath: '.shipfox/workflows/cache-probe.yml',
      syncStartedAfter: seeded.syncStartedAfter,
      token,
    });

    // One run holds the miss, the save, the exact hit, the prefix hit, and the save race.
    const apiClient = createApiClient({token});
    const run = await awaitRun(
      await fireManualAndAwaitRun({
        client: apiClient,
        definitionId: seeded.definition.id,
        inputs: {},
        scenario: name,
      }),
      {
        seed: ['restore', 'save'],
        elsewhere: ['restore', 'verify'],
        prefix: ['restore', 'verify'],
        race_a: ['save'],
        race_b: ['save'],
        hash_restore: ['restore'],
        hash_save: ['save'],
        hash_reverse: ['restore'],
      },
    );
    expect(run.status).toBe('succeeded');

    const missKey = outputs(run, 'seed', 'restore');
    expect(missKey).toMatchObject({hit: false});
    expect(String(missKey.key)).toMatch(new RegExp(`^${depsKey}-[0-9a-f]{32}$`));
    expect(outputs(run, 'seed', 'save')).toEqual({saved: true});
    // A different checkout path, working directory, and home restore the same entry exactly.
    expect(outputs(run, 'elsewhere', 'restore')).toEqual({
      key: missKey.key,
      hit: true,
      matched_key: missKey.key,
      matched_scope: 'default',
    });
    // Another lock hashes to another key, so the restore falls back to the newest prefix match.
    const prefix = outputs(run, 'prefix', 'restore');
    expect(prefix).toMatchObject({hit: false, matched_key: missKey.key, matched_scope: 'default'});
    expect(prefix.key).not.toBe(missKey.key);
    // The first save of a key wins, whether the two jobs overlapped or ran one after the other.
    const saved = [outputs(run, 'race_a', 'save').saved, outputs(run, 'race_b', 'save').saved];
    expect(saved.sort()).toEqual([false, true]);
    // hashFiles() in the workflow builds the key key_files builds in the action, both ways.
    expect(outputs(run, 'hash_restore', 'restore')).toMatchObject({key: missKey.key, hit: true});
    const hashSaved = outputs(run, 'hash_reverse', 'restore');
    expect(hashSaved).toMatchObject({hit: true});
    expect(String(hashSaved.key)).toMatch(
      new RegExp(`^${hashKey}-(linux|darwin)-(x64|arm64)-[0-9a-f]{32}$`),
    );

    // A dev run reads the synced entries, but what it saves goes to the sandbox of its user.
    const devRun = async (content: string) => {
      const created = await callTool(client, 'create_dev_run', {
        project_id: seeded.project.id,
        content,
        actions: ACTIONS.map((action) => ({
          path: `./.shipfox/actions/${action}`,
          files: actionFiles
            .filter(
              (file) =>
                file.path.startsWith(`.shipfox/actions/${action}/`) &&
                !file.path.endsWith('.test.ts'),
            )
            .map((file) => ({
              path: file.path.slice(`.shipfox/actions/${action}/`.length),
              content: file.content,
            })),
        })),
        config_path: DEV_CONFIG_PATH,
        trigger: 'manual',
      });
      expect(created.envelope.ok).toBe(true);
      if (!created.envelope.ok) throw new Error('The dev run returned an MCP error');
      const result = createDevRunResultSchema.parse(created.envelope.result);
      if (!('run_id' in result)) throw new Error('The dev run did not return a run id');
      return await awaitRun(result.run_id, {dev: ['restore', 'save']});
    };

    const firstDev = await devRun(
      devWorkflow({runnerLabel, homeRoot, depsKey, saveKey: devOnlyKey}),
    );
    expect(firstDev.status).toBe('succeeded');
    expect(outputs(firstDev, 'dev', 'restore')).toMatchObject({
      hit: true,
      matched_scope: 'default',
    });
    expect(outputs(firstDev, 'dev', 'save')).toEqual({saved: true});

    // The same user's next dev run sees the sandbox.
    const secondDev = await devRun(
      devWorkflow({runnerLabel, homeRoot, depsKey, restoreKey: devOnlyKey}),
    );
    expect(secondDev.status).toBe('succeeded');
    expect(outputs(secondDev, 'dev', 'restore')).toMatchObject({
      hit: true,
      matched_key: devOnlyKey,
    });

    // A synced run does not.
    const probeRun = await awaitRun(
      await fireManualAndAwaitRun({
        client: apiClient,
        definitionId: probeDefinition.id,
        inputs: {},
        scenario: `${name}-probe`,
      }),
      {probe: ['restore']},
    );
    expect(probeRun.status).toBe('succeeded');
    expect(outputs(probeRun, 'probe', 'restore')).toMatchObject({key: devOnlyKey, hit: false});
    expect(outputs(probeRun, 'probe', 'restore').matched_key).toBeUndefined();
  } finally {
    await client.close().catch(() => undefined);
    await attachLocalRunnerLog(
      (attachment) =>
        testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch(() => undefined);
    await rm(homeRoot, {recursive: true, force: true});
  }
});

function outputs(
  observation: WorkflowRunObservation,
  jobKey: string,
  stepKey: string,
): Record<string, unknown> {
  const step: WorkflowStepObservation | undefined = observation.jobs
    .find((job) => job.key === jobKey)
    ?.executions.flatMap((execution) => execution.steps)
    .find((candidate) => candidate.key === stepKey);
  if (step === undefined) throw new Error(`Step ${jobKey}.${stepKey} is missing`);
  return step.outputs as Record<string, unknown>;
}

// The caches hold one directory under the working directory and one under the home directory.
const PATHS = `node_modules
~/.cache-e2e`;

/** Run step that lays out a checkout: a lock file, node_modules, and a file under the home. */
function layout(params: {directory: string; lock: string}): string {
  return `set -eu
cd ${params.directory}
echo '${params.lock}' > lock.txt
mkdir -p node_modules/pkg "$HOME/.cache-e2e"
echo module > node_modules/pkg/index.js
echo home > "$HOME/.cache-e2e/marker"`;
}

function synced(params: {
  runnerLabel: string;
  homeRoot: string;
  depsKey: string;
  raceKey: string;
  hashKey: string;
}): string {
  const {runnerLabel, homeRoot, depsKey, raceKey, hashKey} = params;
  const platformKey = `${hashKey}-\${{ runner.os }}-\${{ runner.arch }}`;
  // The restoring jobs find nothing on disk before the restore, so a passing verify step
  // proves that the files came from the cache.
  const verify = (directory: string) => `set -eu
cd ${directory}
test "$(cat node_modules/pkg/index.js)" = module
test "$(cat "$HOME/.cache-e2e/marker")" = home`;
  const indent = (script: string) => script.replaceAll('\n', '\n          ');
  return `
name: Cache
runner: ${runnerLabel}
triggers:
  manual:
    source: manual
jobs:
  seed:
    env:
      HOME: ${homeRoot}/seed
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
      - key: layout
        run: |
          ${indent(layout({directory: '.', lock: LOCK_V1}))}
      - key: restore
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${depsKey}
          key_files: lock.txt
          restore_keys: ${depsKey}-
      - key: save
        uses: ./.shipfox/actions/cache-save
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: \${{ steps.restore.outputs.key }}
  elsewhere:
    needs: [seed]
    env:
      HOME: ${homeRoot}/elsewhere
    steps:
      - key: mkhome
        run: mkdir -p "$HOME" packages/app
      - key: lock
        working_directory: packages/app
        run: echo '${LOCK_V1}' > lock.txt
      - key: restore
        working_directory: packages/app
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${depsKey}
          key_files: lock.txt
          fail_on_miss: true
      - key: verify
        working_directory: packages/app
        run: |
          ${indent(verify('.'))}
  prefix:
    needs: [seed]
    env:
      HOME: ${homeRoot}/prefix
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
      - key: lock
        run: echo '${LOCK_V2}' > lock.txt
      - key: restore
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${depsKey}
          key_files: lock.txt
          restore_keys: ${depsKey}-
      - key: verify
        run: |
          ${indent(verify('.'))}
  race_a:
    needs: [seed]
    env:
      HOME: ${homeRoot}/race-a
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
      - key: layout
        run: |
          ${indent(layout({directory: '.', lock: LOCK_V1}))}
      - key: save
        uses: ./.shipfox/actions/cache-save
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${raceKey}
  race_b:
    needs: [seed]
    env:
      HOME: ${homeRoot}/race-b
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
      - key: layout
        run: |
          ${indent(layout({directory: '.', lock: LOCK_V1}))}
      - key: save
        uses: ./.shipfox/actions/cache-save
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${raceKey}
  hash_restore:
    needs: [seed]
    env:
      HOME: ${homeRoot}/hash-restore
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
      - key: lock
        run: echo '${LOCK_V1}' > lock.txt
      - key: restore
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${depsKey}-\${{ hashFiles('lock.txt') }}
          fail_on_miss: true
  hash_save:
    needs: [seed]
    env:
      HOME: ${homeRoot}/hash-save
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
      - key: layout
        run: |
          ${indent(layout({directory: '.', lock: LOCK_V2}))}
      - key: save
        uses: ./.shipfox/actions/cache-save
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${platformKey}-\${{ hashFiles('lock.txt') }}
  hash_reverse:
    needs: [hash_save]
    env:
      HOME: ${homeRoot}/hash-reverse
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
      - key: lock
        run: echo '${LOCK_V2}' > lock.txt
      - key: restore
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: |
            ${PATHS.replaceAll('\n', '\n            ')}
          key: ${platformKey}
          key_files: lock.txt
          fail_on_miss: true
`;
}

/** Restores one key and does nothing else. A synced run uses it to look for a dev run's entry. */
function probe(params: {runnerLabel: string; key: string}): string {
  return `
name: Cache probe
runner: ${params.runnerLabel}
triggers:
  manual:
    source: manual
jobs:
  probe:
    steps:
      - key: restore
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: node_modules
          key: ${params.key}
`;
}

/**
 * The dev workflow either restores the synced entry and saves a new key, or restores a key
 * that an earlier dev run saved.
 */
function devWorkflow(
  params: {runnerLabel: string; homeRoot: string; depsKey: string} & (
    | {saveKey: string; restoreKey?: undefined}
    | {restoreKey: string; saveKey?: undefined}
  ),
): string {
  const indent = (script: string) => script.replaceAll('\n', '\n          ');
  const paths = PATHS.replaceAll('\n', '\n            ');
  const body =
    params.saveKey === undefined
      ? `      - key: restore
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: |
            ${paths}
          key: ${params.restoreKey}`
      : `      - key: lock
        run: echo '${LOCK_V1}' > lock.txt
      - key: restore
        uses: ./.shipfox/actions/cache-restore
        with:
          paths: |
            ${paths}
          key: ${params.depsKey}
          key_files: lock.txt
      - key: files
        run: |
          ${indent(layout({directory: '.', lock: LOCK_V1}))}
      - key: save
        uses: ./.shipfox/actions/cache-save
        with:
          paths: |
            ${paths}
          key: ${params.saveKey}`;
  return `
name: Cache dev
runner: ${params.runnerLabel}
triggers:
  manual:
    source: manual
jobs:
  dev:
    env:
      HOME: ${params.homeRoot}/dev
    steps:
      - key: mkhome
        run: mkdir -p "$HOME"
${body}
`;
}
