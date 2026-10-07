import {mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {type ActionBundleFile, encodeActionBundle} from '@shipfox/workflow-document';
import {type ActionStepOptions, executeActionStep} from '#core/action-step.js';

const BACKGROUND_PID_REGEX = /BACKGROUND_PID=(\d+)/;
const ENV_REGEX = /ENV=(\{.*\})/;
const RUNTIME_LINE_REGEX =
  /^Shipfox action Greeter sha256:[0-9a-f]{64} · node v\d+\.\d+\.\d+ · @shipfox\/actions \S+$/;

interface Sandbox {
  root: string;
  workspace: string;
  jobTempDir: string;
}

let sandbox: Sandbox;

beforeEach(async () => {
  // Node reports real paths (the macOS tmpdir is a symlink), so the sandbox uses them too.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-action-step-')));
  sandbox = {root, workspace: join(root, 'workspace'), jobTempDir: join(root, 'job')};
  await mkdir(sandbox.workspace);
  await mkdir(sandbox.jobTempDir);
});

afterEach(async () => {
  await rm(sandbox.root, {recursive: true, force: true});
});

async function actionStep(
  entry: string,
  params: {
    config?: Record<string, unknown>;
    origin?: 'local' | 'registry';
    extraFiles?: ActionBundleFile[];
  } = {},
): Promise<{step: StepDto; gzip: Uint8Array; digest: string}> {
  const bundle = await encodeActionBundle({
    files: [{path: 'index.js', content: entry}, ...(params.extraFiles ?? [])],
  });
  const step = {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000002',
    key: 'greet',
    name: 'Greet',
    source_location: null,
    status: 'running',
    status_reason: null,
    type: 'action',
    config: {
      action: {
        uses: './.shipfox/actions/greeter',
        ...(params.origin ? {origin: params.origin} : {}),
        digest: bundle.digest,
        main: 'index.js',
        name: 'Greeter',
      },
      job_key: 'build',
      ...params.config,
    },
    evaluation_trace: null,
    error: null,
    position: 1,
    current_attempt: 1,
    created_at: '2026-09-27T00:00:00.000Z',
    updated_at: '2026-09-27T00:00:00.000Z',
  } satisfies StepDto;
  return {step, gzip: bundle.gzip, digest: bundle.digest};
}

function run(
  action: {step: StepDto; gzip: Uint8Array},
  options: Partial<ActionStepOptions> = {},
): Promise<Awaited<ReturnType<typeof executeActionStep>>> & {output: () => string} {
  const chunks: Buffer[] = [];
  const promise = executeActionStep(action.step, {
    cwd: sandbox.workspace,
    workspace: sandbox.workspace,
    jobTempDir: sandbox.jobTempDir,
    runId: 'run-1',
    jobId: 'job-1',
    loadBundle: () => Promise.resolve(action.gzip),
    onOutput: (chunk) => chunks.push(chunk),
    ...options,
  });
  return Object.assign(promise, {output: () => Buffer.concat(chunks).toString()});
}

function action(body: string): string {
  return `import {defineAction} from '@shipfox/actions';\nexport default defineAction(${body});\n`;
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Process ${pid} is still running`);
}

describe('executeActionStep', () => {
  it('runs the action with its inputs and returns its outputs', async () => {
    const step = await actionStep(
      action(
        "async ({inputs, context}) => ({greeting: inputs.greeting + ', ' + inputs.name, cwd: process.cwd(), job: context.jobKey})",
      ),
      {
        config: {
          inputs: {greeting: 'Hello'},
          outputs: {greeting: {type: 'string'}, cwd: {type: 'string'}, job: {type: 'string'}},
        },
      },
    );
    const appDir = join(sandbox.workspace, 'app');
    await mkdir(appDir);
    const lines: string[] = [];

    const result = await run(step, {
      cwd: appDir,
      secretInputs: {name: 'world'},
      onLogLine: (line) => lines.push(line),
    });

    expect(result).toMatchObject({
      success: true,
      exit_code: 0,
      outputs: {greeting: 'Hello, world', cwd: appDir, job: 'build'},
    });
    expect(lines[0]).toMatch(RUNTIME_LINE_REGEX);
  });

  it('extracts the bundle once per job with read-only files and an ESM package.json', async () => {
    const step = await actionStep(action('async () => {}'));
    const loadBundle = vi.fn(() => Promise.resolve(step.gzip));

    await run(step, {loadBundle});
    const second = await run(step, {loadBundle});

    const bundleDir = join(sandbox.jobTempDir, 'actions', step.digest.replace(':', '-'));
    expect(second.success).toBe(true);
    expect(loadBundle).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(join(bundleDir, 'package.json'), 'utf8'))).toEqual({
      type: 'module',
    });
    expect((await stat(join(bundleDir, 'index.js'))).mode & 0o777).toBe(0o444);
  });

  it('removes the step files after the action exits', async () => {
    const step = await actionStep(action('async () => {}'));

    await run(step, {secretInputs: {token: 'input-secret'}});

    expect(await readdir(join(sandbox.jobTempDir, 'steps'))).toEqual([]);
  });

  it('keeps every scratch file in the job temp directory', async () => {
    const step = await actionStep(action('async () => {}'));

    await run(step);

    expect((await readdir(sandbox.jobTempDir)).sort()).toEqual(['actions', 'steps']);
  });

  it('fails with action_unavailable when the bundle does not match its digest', async () => {
    const step = await actionStep(action('async () => {}'));
    const other = await encodeActionBundle({files: [{path: 'index.js', content: ''}]});

    const result = await run({...step, gzip: other.gzip});

    expect(result).toMatchObject({
      success: false,
      error: {reason: 'action_unavailable'},
      exit_code: null,
    });
    expect(result.error?.message).toContain('The action could not be loaded');
  });

  it('fails when the handler throws, with the error in the step log', async () => {
    const step = await actionStep(
      action("async () => { throw new Error('Slack thread not found'); }"),
    );

    const pending = run(step);
    const result = await pending;

    expect(result).toMatchObject({
      success: false,
      error: {message: 'The action failed with exit code 1.', exit_code: 1},
      exit_code: 1,
    });
    expect(pending.output()).toContain('Slack thread not found');
  });

  it('rejects a workspace package for a registry action and allows it for a local one', async () => {
    const helperDir = join(sandbox.workspace, 'node_modules', 'helper');
    await mkdir(helperDir, {recursive: true});
    await writeFile(
      join(helperDir, 'package.json'),
      JSON.stringify({name: 'helper', type: 'module', exports: './index.js'}),
    );
    await writeFile(join(helperDir, 'index.js'), "export const help = () => 'helped';");
    const entry = `import {defineAction} from '@shipfox/actions';
import {help} from 'helper';
export default defineAction(() => ({value: help()}));
`;
    const config = {outputs: {value: {type: 'string'}}};
    const registry = await actionStep(entry, {origin: 'registry', config});
    const local = await actionStep(entry, {origin: 'local', config});

    const rejected = run(registry);
    const rejectedResult = await rejected;
    const allowed = await run(local);

    expect(rejectedResult).toMatchObject({success: false, exit_code: 1});
    expect(rejected.output()).toContain('ERR_SHIPFOX_REGISTRY_ACTION_IMPORT');
    expect(allowed).toMatchObject({success: true, outputs: {value: 'helped'}});
  });

  it('fails an action that exits with code 0 before its handler finished', async () => {
    const step = await actionStep(action('async () => { process.exit(0); }'));

    const result = await run(step);

    expect(result).toMatchObject({
      success: false,
      error: {message: 'The action exited before it finished.', exit_code: 0},
      exit_code: 0,
    });
  });

  it('reports a crash by signal', async () => {
    const step = await actionStep(action("async () => { process.kill(process.pid, 'SIGKILL'); }"));

    const result = await run(step);

    expect(result).toMatchObject({
      success: false,
      error: {message: 'Killed by signal SIGKILL', signal: 'SIGKILL'},
      exit_code: null,
    });
  });

  it('reports out of memory when the crash raises the cgroup oom_kill counter', async () => {
    const memoryEventsPath = join(sandbox.root, 'memory.events');
    await writeFile(memoryEventsPath, 'oom 0\noom_kill 2\n');
    const step = await actionStep(
      action(
        `async () => { (await import('node:fs')).writeFileSync(${JSON.stringify(memoryEventsPath)}, 'oom 0\\noom_kill 3\\n'); process.kill(process.pid, 'SIGKILL'); }`,
      ),
    );

    const result = await run(step, {memoryEventsPath});

    expect(result.error?.message).toContain('because the runner ran out of memory');
  });

  it('keeps outputs set before the action failed', async () => {
    const step = await actionStep(
      action(
        "async ({setOutput}) => { setOutput('path', 'context/thread.md'); throw new Error('boom'); }",
      ),
      {config: {outputs: {path: {type: 'string'}}}},
    );

    const result = await run(step);

    expect(result).toMatchObject({success: false, outputs: {path: 'context/thread.md'}});
  });

  it('kills a background process the action left running', async () => {
    const step = await actionStep(
      action(
        "async () => { const {spawn} = await import('node:child_process'); const child = spawn('sleep', ['30'], {stdio: 'ignore'}); console.log('BACKGROUND_PID=' + child.pid); }",
      ),
    );

    const pending = run(step);
    const result = await pending;

    const backgroundPid = Number(BACKGROUND_PID_REGEX.exec(pending.output())?.[1]);
    expect(result.success).toBe(true);
    expect(backgroundPid).toBeGreaterThan(0);
    await waitForProcessExit(backgroundPid);
  });

  it('builds the environment from the allowlist, the step env, and the action contract', async () => {
    vi.stubEnv('SHIPFOX_API_URL', 'https://api.example.test');
    vi.stubEnv('SHIPFOX_RUNNER_REGISTRATION_TOKEN', 'runner-secret');
    vi.stubEnv('NODE_OPTIONS', '--max-old-space-size=4096');
    vi.stubEnv('OPENAI_API_KEY', 'operator-key');
    vi.stubEnv('LC_ALL', 'C.UTF-8');
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example.test:3128');
    const step = await actionStep(
      action("async () => { console.log('ENV=' + JSON.stringify(process.env)); }"),
      {config: {env: {REGION: 'eu'}}},
    );

    const pending = run(step, {secretEnv: {NPM_TOKEN: 'npm-secret'}});
    await pending;
    vi.unstubAllEnvs();

    const env = JSON.parse(ENV_REGEX.exec(pending.output())?.[1] ?? '{}') as Record<string, string>;
    expect(env).toMatchObject({
      PATH: process.env.PATH,
      LC_ALL: 'C.UTF-8',
      HTTPS_PROXY: 'http://proxy.example.test:3128',
      REGION: 'eu',
      NPM_TOKEN: 'npm-secret',
      SHIPFOX_WORKSPACE: sandbox.workspace,
      SHIPFOX_ACTION_MAIN: 'index.js',
    });
    expect(Object.keys(env).filter((key) => key.startsWith('SHIPFOX_RUNNER_'))).toEqual([]);
    expect(env).not.toHaveProperty('SHIPFOX_API_URL');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('SHIPFOX_ACTIONS_TOKEN');
    expect(env).not.toHaveProperty('SHIPFOX_ACTION_INPUTS');
  });

  it('sets the shipfox_env variables over the step env', async () => {
    const step = await actionStep(
      action("async () => { console.log('ENV=' + JSON.stringify(process.env)); }"),
      {
        config: {
          env: {SHIPFOX_RUN_ID: 'user-run-id'},
          shipfox_env: {SHIPFOX_RUN_ID: 'run-1', SHIPFOX_RUN_NUMBER: '7'},
        },
      },
    );

    const pending = run(step);
    await pending;

    const env = JSON.parse(ENV_REGEX.exec(pending.output())?.[1] ?? '{}') as Record<string, string>;
    expect(env).toMatchObject({SHIPFOX_RUN_ID: 'run-1', SHIPFOX_RUN_NUMBER: '7'});
  });

  it('serves the action tool calls through the gateway and hands the token out for masking', async () => {
    const step = await actionStep(
      action(
        "async ({tools}) => ({text: (await tools.slack.call('read_thread', {channel: 'C1'})).text()})",
      ),
      {
        config: {
          integrations: [
            {
              alias: 'slack',
              provider: 'slack',
              connection_slug: 'team-slack',
              tools: [
                {
                  id: 'read_thread',
                  sensitivity: 'read',
                  sensitive: false,
                  result: 'json',
                  input_schema: {type: 'object'},
                },
              ],
            },
          ],
          outputs: {text: {type: 'string'}},
        },
      },
    );
    const callTool = vi.fn().mockResolvedValue({content: [{type: 'text', text: 'thread body'}]});
    const onSecret = vi.fn();
    const onToolRow = vi.fn();

    const result = await run(step, {onSecret, onToolRow, toolsUpstream: {callTool}});

    expect(result).toMatchObject({success: true, outputs: {text: 'thread body'}});
    expect(callTool).toHaveBeenCalledWith(
      {name: 'team_slack__read_thread', arguments: {channel: 'C1'}},
      expect.objectContaining({headers: {'x-shipfox-call-id': expect.any(String)}}),
    );
    expect(onSecret).toHaveBeenCalledWith(expect.any(String));
    expect(onToolRow.mock.calls.map(([row]) => row.kind)).toEqual(['tool-call', 'tool-result']);
  });

  it('fails tool calls when the runner has no gateway', async () => {
    const step = await actionStep(
      action(
        "async ({tools}) => { try { await tools.slack.call('read_thread', {}); } catch (error) { return {code: error.code}; } }",
      ),
      {
        config: {
          integrations: [
            {
              alias: 'slack',
              connection_slug: 'team-slack',
              tools: [{id: 'read_thread', sensitivity: 'read', input_schema: {}}],
            },
          ],
          outputs: {code: {type: 'string'}},
        },
      },
    );

    const result = await run(step);

    expect(result).toMatchObject({success: true, outputs: {code: 'tools-unavailable'}});
  });
});
