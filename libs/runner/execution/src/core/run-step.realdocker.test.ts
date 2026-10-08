import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {
  ContainerExecutionHost,
  jobContainerName,
  removeJobContainer,
  startJobContainer,
} from '@shipfox/runner-container';
import {executeRunStep, type OutputSink, type StepProcessOptions} from '#core/run-step.js';

// The container path is only right if a real container accepts it: the preamble, the PID file,
// and the files shared through the mounts behave differently from a local spawn.
const IMAGES = ['busybox:1.37', 'debian:bookworm-slim'];
const PID_LINE = /pid=(\d+)/u;
const CARRIED_PATH_FIRST = /^\/opt\/carried:/u;
const KILLED_BY_SIGKILL = /Killed by signal SIGKILL/u;

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
  dispose: () => Promise<void>;
}

async function startFixture(image: string, options = ''): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-run-step-container-')));
  const dirs = {
    workspaceDir: join(root, 'job'),
    tempDir: join(root, 'tmp'),
    agentStateDir: join(root, 'agent'),
    credentialsDir: join(root, 'cred'),
    logsDir: join(root, 'logs'),
  };
  for (const dir of Object.values(dirs)) await mkdir(dir);
  await writeFile(join(root, 'node'), '');
  await chmod(join(root, 'node'), 0o755);
  const jobId = randomUUID();
  const container = await startJobContainer({
    jobId,
    image,
    options,
    dockerSocket: false,
    ...dirs,
    runnerInstallDir: root,
    nodeBinary: join(root, 'node'),
    signal: new AbortController().signal,
  });
  return {
    host: new ContainerExecutionHost({container: container.name, tempDir: dirs.tempDir}),
    name: container.name,
    root,
    dirs,
    dispose: async () => {
      await removeJobContainer(jobContainerName(jobId));
      await rm(root, {recursive: true, force: true});
    },
  };
}

function buildStep(config: Record<string, unknown>): StepDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    key: 'container-step',
    name: 'container-step',
    source_location: null,
    status: 'running',
    status_reason: null,
    type: 'run',
    config,
    error: null,
    evaluation_trace: null,
    session: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function collectOutput(): {sink: OutputSink; text: () => string} {
  const chunks: Buffer[] = [];
  return {
    sink: (chunk) => {
      chunks.push(chunk);
    },
    text: () => Buffer.concat(chunks).toString(),
  };
}

async function containerOptions(
  fixture: Fixture,
  env: Record<string, string> = {},
): Promise<StepProcessOptions> {
  const {shell, path} = await fixture.host.probe();
  return {
    host: fixture.host,
    env: {PATH: path, ...env},
    shell,
    shareScratchFiles: true,
    tempDir: fixture.dirs.tempDir,
    cwd: fixture.dirs.workspaceDir,
    workspace: fixture.dirs.workspaceDir,
  };
}

describe.skipIf(!dockerAvailable()).each(IMAGES)('run steps in a container on %s', (image) => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await startFixture(image);
  }, 180_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it('runs the script in the container, from the working directory', async () => {
    const output = collectOutput();

    const result = await executeRunStep(
      buildStep({run: 'test -e /etc/debian_version && echo debian || echo other; pwd'}),
      {
        ...(await containerOptions(fixture)),
        onOutput: output.sink,
      },
    );

    expect(result.success).toBe(true);
    expect(output.text()).toContain(image.startsWith('busybox') ? 'other\n' : 'debian\n');
    expect(output.text()).toContain(fixture.dirs.workspaceDir);
  });

  it('starts from the container environment and orders the layers', async () => {
    const output = collectOutput();
    process.env.SHIPFOX_RUNNER_ONLY = 'leaked';
    try {
      const result = await executeRunStep(
        buildStep({
          run: 'echo "layers=$LAYER runner=$SHIPFOX_RUNNER_ONLY secret=$SECRET_ONLY"',
          env: {LAYER: 'step'},
        }),
        {
          ...(await containerOptions(fixture, {LAYER: 'container', KEPT: 'yes'})),
          secretEnv: {SECRET_ONLY: 's3cret'},
          onOutput: output.sink,
        },
      );

      expect(result.success).toBe(true);
      expect(output.text()).toBe('layers=step runner= secret=s3cret\n');
    } finally {
      delete process.env.SHIPFOX_RUNNER_ONLY;
    }
  });

  it('keeps multi-line and quoted values intact', async () => {
    const value = `it's a\nmulti-line $HOME "quoted" \`value\` \\n`;
    const output = collectOutput();

    const result = await executeRunStep(
      buildStep({run: 'printf %s "$TRICKY"', env: {TRICKY: value}}),
      {
        ...(await containerOptions(fixture)),
        onOutput: output.sink,
      },
    );

    expect(result.success).toBe(true);
    expect(output.text()).toBe(value);
  });

  it('reports outputs, a summary, and annotations written in the container', async () => {
    const operation = JSON.stringify({
      context: 'deploy',
      style: 'success',
      op: 'replace',
      body: 'deployed',
    });

    const result = await executeRunStep(
      buildStep({
        run: [
          'echo "answer=42" >> "$SHIPFOX_OUTPUT"',
          'echo "### Summary" >> "$SHIPFOX_STEP_SUMMARY"',
          `printf '%s' '${operation}' > "$SHIPFOX_ANNOTATIONS_DIR/001-op.json"`,
          'echo from-file > result.txt',
        ].join('\n'),
        output_sources: {file_value: {from_file: 'result.txt'}},
      }),
      await containerOptions(fixture),
    );

    expect(result.success).toBe(true);
    expect(result.outputs).toEqual({answer: '42', file_value: 'from-file'});
    expect(result.annotations).toEqual([
      {context: 'default', style: 'default', op: 'replace', body: '### Summary\n'},
      {context: 'deploy', style: 'success', op: 'replace', body: 'deployed'},
    ]);
  });

  it('reads the step log through log_path', async () => {
    const logPath = join(fixture.dirs.logsDir, 'previous-step.log');
    await writeFile(logPath, 'log line\n');
    const output = collectOutput();

    const result = await executeRunStep(buildStep({run: 'cat "$LOG_PATH"'}), {
      ...(await containerOptions(fixture)),
      shipfoxEnv: {LOG_PATH: logPath},
      onOutput: output.sink,
    });

    expect(result.success).toBe(true);
    expect(output.text()).toBe('log line\n');
  });

  it('puts the directories earlier steps carried in front of the image PATH', async () => {
    const output = collectOutput();

    const result = await executeRunStep(buildStep({run: 'echo "$PATH"'}), {
      ...(await containerOptions(fixture)),
      carriedEnv: {env: {}, path: ['/opt/carried']},
      onOutput: output.sink,
    });

    expect(result.success).toBe(true);
    expect(output.text()).toMatch(CARRIED_PATH_FIRST);
  });

  it('reads what the step wrote to SHIPFOX_ENV and SHIPFOX_PATH', async () => {
    const result = await executeRunStep(
      buildStep({run: 'echo "CARRIED=yes" >> "$SHIPFOX_ENV"; echo /opt/bin >> "$SHIPFOX_PATH"'}),
      await containerOptions(fixture),
    );

    expect(result.success).toBe(true);
    expect(result.carriedEnv).toEqual({env: {CARRIED: 'yes'}, path: ['/opt/bin']});
  });

  it('reports the exit code of a failing script', async () => {
    const result = await executeRunStep(
      buildStep({run: 'exit 7'}),
      await containerOptions(fixture),
    );

    expect(result).toMatchObject({success: false, exit_code: 7});
  });

  it('kills the whole process tree in the container on cancel', async () => {
    const controller = new AbortController();
    const output = collectOutput();
    const running = executeRunStep(buildStep({run: 'sleep 300 & echo "pid=$!"; wait'}), {
      ...(await containerOptions(fixture)),
      signal: controller.signal,
      onOutput: output.sink,
    });
    await vi.waitFor(() => expect(output.text()).toMatch(PID_LINE), {timeout: 20_000});
    const pid = output.text().match(PID_LINE)?.[1] ?? '';

    controller.abort();
    const result = await running;

    expect(result.success).toBe(false);
    expect(result.error?.message).toMatch(KILLED_BY_SIGKILL);
    await vi.waitFor(
      () => {
        const alive = execFileSync('docker', [
          'exec',
          fixture.name,
          'sh',
          '-c',
          `kill -0 ${pid}; echo $?`,
        ])
          .toString()
          .trim();
        expect(alive).not.toBe('0');
      },
      {timeout: 20_000},
    );
  }, 60_000);

  it('leaves no environment, script, or output file behind', async () => {
    await executeRunStep(buildStep({run: 'true', env: {A: 'b'}}), await containerOptions(fixture));

    // Only the recorded process IDs stay, until the job directory goes.
    expect((await readdir(fixture.dirs.tempDir)).filter((name) => !name.endsWith('.pid'))).toEqual(
      [],
    );
  });
});

describe.skipIf(!dockerAvailable())('run steps in a non-root container', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await startFixture('busybox:1.37', '--user 1234:1234');
  }, 180_000);

  afterAll(async () => {
    await fixture?.dispose();
  });

  it('writes the output file, the summary, and annotations as another user', async () => {
    const operation = JSON.stringify({context: 'a', style: 'info', op: 'replace', body: 'b'});

    const result = await executeRunStep(
      buildStep({
        run: [
          'id -u',
          'echo "who=$(id -u)" >> "$SHIPFOX_OUTPUT"',
          'echo summary >> "$SHIPFOX_STEP_SUMMARY"',
          'echo CARRIED=yes >> "$SHIPFOX_ENV"',
          `printf '%s' '${operation}' > "$SHIPFOX_ANNOTATIONS_DIR/001-op.json"`,
        ].join('\n'),
      }),
      await containerOptions(fixture),
    );

    expect(result.success).toBe(true);
    expect(result.outputs).toEqual({who: '1234'});
    expect(result.carriedEnv).toEqual({env: {CARRIED: 'yes'}, path: []});
    expect(result.annotations).toHaveLength(2);
    expect((await readdir(fixture.dirs.tempDir)).filter((name) => !name.endsWith('.pid'))).toEqual(
      [],
    );
  });
});
