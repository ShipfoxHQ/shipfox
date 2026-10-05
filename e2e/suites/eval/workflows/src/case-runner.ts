import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {
  type LocalRunnerExit,
  localRunnerLogTail,
  mintManualRegistrationToken,
  startLocalRunner,
  stopLocalRunner,
  waitForLocalRunnerExit,
} from '@shipfox/e2e-driver-runner-process';

const RUNNER_TOKEN_TTL_SECONDS = 3_600;

export interface CaseRunner {
  /** The label the case's definitions send their jobs to. */
  label: string;
  logFile: string;
  exit: () => LocalRunnerExit | undefined;
  /** Aborts when the runner exits before the cleanup stops it. */
  aborted: AbortSignal;
  tail: () => string;
}

/**
 * A local runner of its own for one workspace, so a run's jobs never meet another run's runner.
 * The cleanup stops it, and a runner that exits earlier aborts `aborted`.
 */
export async function startCaseRunner({
  workspaceId,
  userToken,
  uniqueId,
  workDirectory,
  cleanups,
}: {
  workspaceId: string;
  userToken: string;
  uniqueId: string;
  /** Runner logs and workspaces go below this directory. */
  workDirectory: string;
  cleanups: Array<() => Promise<void>>;
}): Promise<CaseRunner> {
  const label = `eval-${uniqueId}`;
  const runnerDirectory = join(workDirectory, 'runners');
  await mkdir(runnerDirectory, {recursive: true});
  const logFile = join(runnerDirectory, `${label}.log`);
  // Job git config includes the global one, so a developer's commit signing would break pushes.
  const gitConfig = join(runnerDirectory, `${label}.gitconfig`);
  await writeFile(gitConfig, '');
  const registrationToken = await mintManualRegistrationToken({
    workspaceId,
    userToken,
    name: `Eval ${uniqueId}`,
    ttlSeconds: RUNNER_TOKEN_TTL_SECONDS,
  });
  const runner = startLocalRunner({
    workspaceId,
    registrationToken: registrationToken.raw_token,
    labels: [label],
    logFile,
    workspaceRoot: join(workDirectory, 'runner-workspaces', label),
    extraEnv: {GIT_CONFIG_GLOBAL: gitConfig},
  });
  let stopping = false;
  cleanups.push(async () => {
    stopping = true;
    await stopLocalRunner(runner);
  });
  let exit: LocalRunnerExit | undefined;
  const exited = new AbortController();
  waitForLocalRunnerExit(runner).then(
    (value) => {
      if (stopping) return;
      exit = value;
      exited.abort();
    },
    () => {
      // The child process failed to spawn or crashed before it could report an exit.
      if (stopping) return;
      exit = {code: null, signal: null};
      exited.abort();
    },
  );

  return {
    label,
    logFile,
    exit: () => exit,
    aborted: exited.signal,
    tail: () => localRunnerLogTail(logFile),
  };
}
