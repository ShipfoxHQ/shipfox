import {execFile} from 'node:child_process';
import {cp, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 60_000;
const OUTPUT_TAIL_CHARACTERS = 4_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface HiddenTestsResult {
  passed: boolean;
  exit_code: number | null;
  /** The end of the test command's output, so a failure can be read. */
  output_tail: string;
}

/**
 * Clones the branch the run pushed, copies in the tests the agent never saw, and runs the
 * case's test command. `hiddenTests` is a file or directory below the case's `hidden_tests`
 * directory, and lands at the same path in the clone.
 */
export async function runHiddenTests({
  repositoryPath,
  branch,
  caseDirectory,
  hiddenTests,
  testCommand,
  timeoutMs,
}: {
  /** The bare repository the GitHub fake serves. */
  repositoryPath: string;
  branch: string;
  caseDirectory: string;
  hiddenTests: string;
  testCommand: string;
  timeoutMs: number;
}): Promise<HiddenTestsResult> {
  const sourceRoot = resolve(caseDirectory, 'hidden_tests');
  const source = resolve(sourceRoot, hiddenTests);
  if (!source.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error(`hidden_tests "${hiddenTests}" points outside the hidden_tests directory.`);
  }

  const directory = await mkdtemp(join(tmpdir(), 'eval-hidden-tests-'));
  try {
    await execFileAsync(
      'git',
      ['clone', '--quiet', '--branch', branch, '--single-branch', repositoryPath, directory],
      {timeout: CLONE_TIMEOUT_MS, env: gitEnvironment()},
    );
    await cp(source, join(directory, hiddenTests), {recursive: true});
    return await runTestCommand({directory, testCommand, timeoutMs});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

// The clone must not pick up a developer's git configuration, such as commit signing.
function gitEnvironment(): NodeJS.ProcessEnv {
  return {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null'};
}

async function runTestCommand({
  directory,
  testCommand,
  timeoutMs,
}: {
  directory: string;
  testCommand: string;
  timeoutMs: number;
}): Promise<HiddenTestsResult> {
  try {
    const {stdout, stderr} = await execFileAsync('sh', ['-c', testCommand], {
      cwd: directory,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    return {passed: true, exit_code: 0, output_tail: tail(`${stdout}${stderr}`)};
  } catch (error) {
    const failure = error as {code?: unknown; stdout?: string; stderr?: string; killed?: boolean};
    const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
    return {
      passed: false,
      exit_code: typeof failure.code === 'number' ? failure.code : null,
      output_tail: tail(failure.killed ? `${output}\nThe test command timed out.` : output),
    };
  }
}

function tail(output: string): string {
  const trimmed = output.trimEnd();
  return trimmed.length > OUTPUT_TAIL_CHARACTERS
    ? `...${trimmed.slice(-OUTPUT_TAIL_CHARACTERS)}`
    : trimmed;
}
