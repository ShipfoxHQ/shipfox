import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {afterEach, beforeEach, describe, expect, it} from '@shipfox/vitest/vi';
import {runHiddenTests} from './hidden-tests.js';

const execFileAsync = promisify(execFile);
const missingFilePattern = /No such file|not found|cannot find/iu;
const missingBranchPattern = /Remote branch missing not found/u;
const outsidePattern = /outside the hidden_tests directory/u;

let root: string;
let repositoryPath: string;
let caseDirectory: string;

async function git(args: string[], cwd?: string): Promise<void> {
  await execFileAsync('git', args, {
    ...(cwd === undefined ? {} : {cwd}),
    env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'},
  });
}

// Pushes one branch whose `value.txt` holds `value` to a bare repository, as an agent's push would.
async function pushBranch({branch, value}: {branch: string; value: string}): Promise<void> {
  const work = await mkdtemp(join(root, 'work-'));
  await git(['init', '--quiet', '--initial-branch', branch, work]);
  await writeFile(join(work, 'value.txt'), value);
  await git(['add', '.'], work);
  await git(
    ['-c', 'user.name=Agent', '-c', 'user.email=agent@example.com', 'commit', '--quiet', '-m', 'x'],
    work,
  );
  await git(['push', '--quiet', repositoryPath, `${branch}:${branch}`], work);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hidden-tests-test-'));
  repositoryPath = join(root, 'repository.git');
  await git(['init', '--bare', '--quiet', repositoryPath]);
  caseDirectory = join(root, 'case');
  await mkdir(join(caseDirectory, 'hidden_tests', 'checks'), {recursive: true});
  await writeFile(
    join(caseDirectory, 'hidden_tests', 'checks', 'value.sh'),
    'test "$(cat value.txt)" = expected\n',
  );
});

afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('hidden tests', () => {
  it('passes when the pushed branch satisfies the copied-in tests', async () => {
    await pushBranch({branch: 'task', value: 'expected'});

    const result = await runHiddenTests({
      repositoryPath,
      branch: 'task',
      caseDirectory,
      hiddenTests: 'checks/value.sh',
      testCommand: 'sh checks/value.sh',
      timeoutMs: 30_000,
    });

    expect(result).toMatchObject({passed: true, exit_code: 0});
  });

  it('fails with the exit code and output when the tests do not pass', async () => {
    await pushBranch({branch: 'task', value: 'wrong'});
    await writeFile(
      join(caseDirectory, 'hidden_tests', 'checks', 'value.sh'),
      'echo "value was $(cat value.txt)"; exit 3\n',
    );

    const result = await runHiddenTests({
      repositoryPath,
      branch: 'task',
      caseDirectory,
      hiddenTests: 'checks',
      testCommand: 'sh checks/value.sh',
      timeoutMs: 30_000,
    });

    expect(result.passed).toBe(false);
    expect(result.exit_code).toBe(3);
    expect(result.output_tail).toContain('value was wrong');
  });

  it('rejects a path that leaves the hidden_tests directory', async () => {
    await pushBranch({branch: 'task', value: 'expected'});

    await expect(
      runHiddenTests({
        repositoryPath,
        branch: 'task',
        caseDirectory,
        hiddenTests: '../case.yaml',
        testCommand: 'true',
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(outsidePattern);
  });

  it('rejects a branch the run never pushed', async () => {
    await pushBranch({branch: 'task', value: 'expected'});

    await expect(
      runHiddenTests({
        repositoryPath,
        branch: 'missing',
        caseDirectory,
        hiddenTests: 'checks/value.sh',
        testCommand: 'true',
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(missingBranchPattern);
  });

  it('copies a path that re-enters hidden_tests to its place in the clone', async () => {
    await pushBranch({branch: 'task', value: 'expected'});

    const result = await runHiddenTests({
      repositoryPath,
      branch: 'task',
      caseDirectory,
      hiddenTests: '../hidden_tests/checks/value.sh',
      testCommand: 'sh checks/value.sh',
      timeoutMs: 30_000,
    });

    expect(result.passed).toBe(true);
  });

  it('keeps a missing hidden test file from passing silently', async () => {
    await pushBranch({branch: 'task', value: 'expected'});

    await expect(
      runHiddenTests({
        repositoryPath,
        branch: 'task',
        caseDirectory,
        hiddenTests: 'checks/absent.sh',
        testCommand: 'true',
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(missingFilePattern);
  });
});
