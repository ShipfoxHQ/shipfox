import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {ACTION_LOADER_PATH} from '@shipfox/actions/runtime-files';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {
  ContainerExecutionHost,
  jobContainerName,
  removeJobContainer,
  startJobContainer,
} from '@shipfox/runner-container';
import {encodeActionBundle} from '@shipfox/workflow-document';
import type {ActionToolsUpstream} from '#core/action-endpoint.js';
import {type ActionStepOptions, executeActionStep} from '#core/action-step.js';
import {executeRunStep} from '#core/run-step.js';

// Needs Docker, and a glibc image: the action runs on the runner's Node binary, which the job
// container mounts.
const IMAGE = 'debian:bookworm-slim';
const NODE_IMAGE = `node:${process.versions.node.split('.')[0]}-bookworm-slim`;
// Debian slim has no `ps`, so the command lines come from /proc.
const COUNT_SLEEPERS =
  'for f in /proc/[0-9]*/cmdline; do tr "\\0" " " < $f 2>/dev/null; echo; done | grep -c "[s]leep 300" || true';
const USERS = [
  ['root', ''],
  ['a non-root user', '--user 1234:1234'],
] as const;

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore', timeout: 10_000});
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  host: ContainerExecutionHost;
  name: string;
  root: string;
  dirs: Record<'workspaceDir' | 'tempDir' | 'agentStateDir' | 'credentialsDir' | 'logsDir', string>;
  runnerInstallDir: string;
  dispose: () => Promise<void>;
}

async function startFixture(options: string): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-action-step-container-')));
  const dirs = {
    workspaceDir: join(root, 'job'),
    tempDir: join(root, 'tmp'),
    agentStateDir: join(root, 'agent'),
    credentialsDir: join(root, 'cred'),
    logsDir: join(root, 'logs'),
  };
  for (const dir of Object.values(dirs)) await mkdir(dir);
  // The job container runs Linux, whatever runs this test, so its Node binary comes from an image.
  const nodeBinary = join(root, 'node');
  await writeFile(nodeBinary, '');
  execFileSync('docker', [
    'run',
    '--rm',
    '-v',
    `${nodeBinary}:/out/node`,
    NODE_IMAGE,
    'cp',
    '/usr/local/bin/node',
    '/out/node',
  ]);
  await chmod(nodeBinary, 0o755);
  // The package that holds the loader and bootstrap stands in for the runner installation.
  const runnerInstallDir = dirname(dirname(ACTION_LOADER_PATH));
  const jobId = randomUUID();
  const name = jobContainerName(jobId);
  // The container user owns what it created, so the container empties the mounts before they go.
  const dispose = async () => {
    try {
      execFileSync('docker', [
        'exec',
        '--user',
        '0',
        name,
        'sh',
        '-c',
        `rm -rf ${root}/job/* ${root}/tmp/*`,
      ]);
    } catch {
      // The container never started, so nothing in it owns anything.
    }
    await removeJobContainer(name);
    await rm(root, {recursive: true, force: true});
  };
  try {
    await startJobContainer({
      jobId,
      image: IMAGE,
      options,
      dockerSocket: false,
      ...dirs,
      runnerInstallDir,
      nodeBinary,
      signal: new AbortController().signal,
    });
  } catch (error) {
    await dispose();
    throw error;
  }
  return {
    host: new ContainerExecutionHost({container: name, tempDir: dirs.tempDir}),
    name,
    root,
    dirs,
    runnerInstallDir,
    dispose,
  };
}

async function actionStep(
  body: string,
  config: Record<string, unknown> = {},
): Promise<{step: StepDto; gzip: Uint8Array}> {
  const bundle = await encodeActionBundle({
    files: [
      {
        path: 'index.js',
        content: `import {defineAction} from '@shipfox/actions';\nexport default defineAction(${body});\n`,
      },
    ],
  });
  const step = {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000002',
    key: 'act',
    name: 'Act',
    source_location: null,
    status: 'running',
    status_reason: null,
    type: 'action',
    config: {
      action: {
        uses: './.shipfox/actions/act',
        digest: bundle.digest,
        main: 'index.js',
        name: 'Act',
      },
      job_key: 'build',
      ...config,
    },
    evaluation_trace: null,
    error: null,
    position: 1,
    current_attempt: 1,
    created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z',
  } satisfies StepDto;
  return {step, gzip: bundle.gzip};
}

function integration(tool: {id: string; result: 'json' | 'file'}) {
  return {
    alias: 'files',
    connection_slug: 'team-files',
    tools: [
      {
        id: tool.id,
        sensitivity: 'read',
        sensitive: false,
        result: tool.result,
        input_schema: {type: 'object'},
      },
    ],
  };
}

async function runAction(
  fixture: Fixture,
  action: {step: StepDto; gzip: Uint8Array},
  options: Partial<ActionStepOptions> = {},
) {
  const {path} = await fixture.host.probe();
  return await executeActionStep(action.step, {
    host: fixture.host,
    container: {runnerInstallDir: fixture.runnerInstallDir, env: {PATH: path}},
    cwd: fixture.dirs.workspaceDir,
    workspace: fixture.dirs.workspaceDir,
    jobTempDir: fixture.dirs.tempDir,
    runId: 'run-1',
    jobId: 'job-1',
    loadBundle: () => Promise.resolve(action.gzip),
    ...options,
  });
}

describe.skipIf(!dockerAvailable()).each(USERS)(
  'action steps in a container as %s',
  (_, options) => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await startFixture(options);
    }, 240_000);

    afterAll(async () => {
      await fixture?.dispose();
    });

    it('runs the action on the runner Node binary and reaches the endpoint on the host network', async () => {
      const action = await actionStep(
        "async ({tools}) => ({text: (await tools.files.call('read', {id: 1})).text(), node: process.execPath})",
        {
          integrations: [integration({id: 'read', result: 'json'})],
          outputs: {text: {type: 'string'}, node: {type: 'string'}},
        },
      );
      const callTool = vi
        .fn()
        .mockResolvedValue({content: [{type: 'text', text: 'from the gateway'}]});

      const result = await runAction(fixture, action, {toolsUpstream: {callTool}});

      expect(result).toMatchObject({
        success: true,
        outputs: {text: 'from the gateway', node: '/__shipfox/node/bin/node'},
      });
      expect(callTool).toHaveBeenCalledWith(
        {name: 'team_files__read', arguments: {id: 1}},
        expect.anything(),
      );
    });

    it('writes a download that a later run step can edit', async () => {
      const action = await actionStep(
        "async ({tools}) => ({path: (await tools.files.download('export', {}, {destination: 'report.txt'})).path})",
        {
          integrations: [integration({id: 'export', result: 'file'})],
          outputs: {path: {type: 'string'}},
        },
      );
      const upstream: ActionToolsUpstream = {
        callTool: () => Promise.reject(new Error('Not a call test.')),
        downloadFile: () =>
          Promise.resolve(new Response('first line\n', {headers: {'content-type': 'text/plain'}})),
      };

      const result = await runAction(fixture, action, {toolsUpstream: upstream});

      expect(result.success).toBe(true);
      const path = join(fixture.dirs.workspaceDir, String(result.outputs?.path));
      const edit = await executeRunStep(
        {
          ...action.step,
          type: 'run',
          config: {run: `echo second line >> "${path}" && cat "${path}"`},
        },
        {
          host: fixture.host,
          env: {PATH: (await fixture.host.probe()).path},
          shell: (await fixture.host.probe()).shell,
          shareScratchFiles: true,
          tempDir: fixture.dirs.tempDir,
          cwd: fixture.dirs.workspaceDir,
          workspace: fixture.dirs.workspaceDir,
        },
      );
      expect(edit.success).toBe(true);
      expect((await fixture.host.readFile(path)).toString()).toBe('first line\nsecond line\n');
    });

    it('keeps secret inputs out of the environment', async () => {
      const action = await actionStep(
        'async ({inputs}) => ({token: inputs.token, inEnv: Object.values(process.env).includes(inputs.token)})',
        {outputs: {token: {type: 'string'}, inEnv: {type: 'boolean'}}},
      );

      const result = await runAction(fixture, action, {secretInputs: {token: 'input-secret'}});

      expect(result).toMatchObject({
        success: true,
        outputs: {token: 'input-secret', inEnv: 'false'},
      });
    });

    it('kills a background process the action left running', async () => {
      const action = await actionStep(
        "async () => { (await import('node:child_process')).spawn('sleep', ['300'], {stdio: 'ignore'}).unref(); }",
      );

      const result = await runAction(fixture, action);

      expect(result.success).toBe(true);
      const sleeping = execFileSync('docker', ['exec', fixture.name, 'sh', '-c', COUNT_SLEEPERS])
        .toString()
        .trim();
      expect(sleeping).toBe('0');
    });
  },
);
