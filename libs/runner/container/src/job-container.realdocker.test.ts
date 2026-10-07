import {execFileSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {jobContainerName, removeJobContainer, startJobContainer} from '#job-container.js';
import {runCommand, runCommandChecked} from '#run-command.js';

// Exercises the container lifecycle against a real daemon: the argument list is only correct if
// Docker accepts it, and a fake docker would accept anything.
const IMAGE = 'busybox:1.37';
const JOB_ID = '00000000-0000-0000-0000-0000000000bb';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], {stdio: 'ignore', timeout: 10_000});
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!dockerAvailable())('job container against Docker', () => {
  let root: string;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'shipfox-realdocker-')));
  });

  afterAll(async () => {
    await removeJobContainer(jobContainerName(JOB_ID));
    await rm(root, {recursive: true, force: true});
  });

  it('pulls, starts, shares the workspace, and removes the container', async () => {
    const dirs = {
      workspaceDir: join(root, 'job'),
      tempDir: join(root, 'tmp'),
      agentStateDir: join(root, 'agent'),
      credentialsDir: join(root, 'cred'),
      logsDir: join(root, 'logs'),
    };
    for (const dir of Object.values(dirs)) await mkdir(dir);
    await writeFile(join(dirs.workspaceDir, 'file.txt'), 'from the host');
    await writeFile(join(root, 'node'), '');
    await chmod(join(root, 'node'), 0o755);
    const lines: string[] = [];

    const container = await startJobContainer({
      jobId: JOB_ID,
      image: IMAGE,
      options: '--label shipfox.test=realdocker',
      dockerSocket: false,
      ...dirs,
      runnerInstallDir: root,
      nodeBinary: join(root, 'node'),
      signal: new AbortController().signal,
      onOutput: (line) => lines.push(line),
    });

    expect(container.name).toBe(jobContainerName(JOB_ID));
    const inspected = await runCommandChecked({
      argv: [
        'docker',
        'inspect',
        '--format',
        '{{.State.Running}} {{.HostConfig.NetworkMode}} {{index .Config.Labels "shipfox.test"}}',
        container.name,
      ],
    });
    expect(inspected.stdout.trim()).toBe('true host realdocker');
    // The host path works inside the container, and the container writes where the host reads.
    const shared = await runCommandChecked({
      argv: [
        'docker',
        'exec',
        container.name,
        'sh',
        '-c',
        `cat ${dirs.workspaceDir}/file.txt && echo from the container > ${dirs.workspaceDir}/out.txt`,
      ],
    });
    expect(shared.stdout).toBe('from the host');
    expect(await readFile(join(dirs.workspaceDir, 'out.txt'), 'utf8')).toBe('from the container\n');
    const readOnly = await runCommand({
      argv: ['docker', 'exec', container.name, 'sh', '-c', `touch ${dirs.logsDir}/x`],
    });
    expect(readOnly.exitCode).not.toBe(0);

    await removeJobContainer(container.name);

    const gone = await runCommand({argv: ['docker', 'inspect', container.name]});
    expect(gone.exitCode).not.toBe(0);
  }, 180_000);

  it("fails with Docker's message when the image does not exist", async () => {
    const dir = join(root, 'missing');
    await mkdir(dir);

    await expect(
      startJobContainer({
        jobId: JOB_ID,
        image: 'shipfox.invalid/does-not-exist:1',
        options: '',
        dockerSocket: false,
        workspaceDir: dir,
        tempDir: dir,
        agentStateDir: dir,
        credentialsDir: dir,
        logsDir: dir,
        runnerInstallDir: dir,
        nodeBinary: process.execPath,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('docker pull');
  }, 60_000);

  it('does not reject when the container is already gone', async () => {
    await expect(removeJobContainer('shipfox-job-never-created')).resolves.toBeUndefined();
  });
});
