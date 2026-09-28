// Runner images lower the runner's OOM score so the kernel kills a runaway step before the runner,
// and every child inherits that score. Agent subprocesses reset their own score before they run
// anything, so a memory-hungry agent command does not outlive the host's daemons. Resetting from
// the runner after spawn would race the subprocess's first fork.
const RESET_OOM_SCORE = '{ echo 0 > /proc/self/oom_score_adj; } 2>/dev/null';

export type OomScoreLaunch = {
  executable: string;
  args: string[];
};

export function withDefaultOomScore(launch: OomScoreLaunch): OomScoreLaunch {
  if (process.platform !== 'linux') return launch;
  return {
    executable: '/bin/sh',
    args: ['-c', `${RESET_OOM_SCORE}; exec "$@"`, 'sh', launch.executable, ...launch.args],
  };
}

export function withDefaultOomScoreShellPrefix(prefix: string | undefined): string | undefined {
  if (process.platform !== 'linux') return prefix;
  return prefix === undefined ? RESET_OOM_SCORE : `${RESET_OOM_SCORE}\n${prefix}`;
}
