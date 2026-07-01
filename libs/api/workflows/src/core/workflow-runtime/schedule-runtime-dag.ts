import type {RuntimeCompletionStatus, RuntimeDagNode} from './runtime-dag.js';
import type {RuntimeSchedulingCommand} from './runtime-scheduling-command.js';

export interface ScheduleRuntimeDagInput<Job extends RuntimeDagNode = RuntimeDagNode> {
  readonly jobs: readonly Job[];
  readonly completed: ReadonlyMap<string, RuntimeCompletionStatus>;
  readonly running?: ReadonlySet<string> | undefined;
}

export function scheduleRuntimeDag<Job extends RuntimeDagNode>(
  input: ScheduleRuntimeDagInput<Job>,
): readonly RuntimeSchedulingCommand<Job>[] {
  const completed = new Map(input.completed);
  const commands: RuntimeSchedulingCommand<Job>[] = [];
  const listeningKeys = new Set(
    input.jobs.filter((job) => job.mode === 'listening').map((job) => job.key),
  );

  for (const job of findBlockedJobs(input.jobs, completed)) {
    commands.push({kind: 'skip-job', job});
    completed.set(job.key, 'failed');
  }

  const ready = findReadyJobs(input.jobs, completed, input.running ?? new Set());
  if (ready.length > 0) {
    commands.push(...ready.map((job): RuntimeSchedulingCommand<Job> => ({kind: 'start-job', job})));
    return commands;
  }

  const running = input.running ?? new Set();
  if (input.jobs.some((job) => running.has(job.key) && !completed.has(job.key))) {
    return commands;
  }

  const remaining = input.jobs.filter((job) => !completed.has(job.key) && job.mode !== 'listening');
  if (
    remaining.some((job) =>
      job.dependencies.some(
        (dependency) => listeningKeys.has(dependency) && !completed.has(dependency),
      ),
    )
  ) {
    return commands;
  }

  if (remaining.length > 0) {
    commands.push(
      ...remaining.map((job): RuntimeSchedulingCommand<Job> => ({kind: 'skip-job', job})),
    );
    commands.push({kind: 'complete-run', status: 'failed'});
    return commands;
  }

  if (input.jobs.some((job) => job.mode === 'listening' && !completed.has(job.key))) {
    return commands;
  }

  commands.push({
    kind: 'complete-run',
    status: hasFailure(completed) ? 'failed' : 'succeeded',
  });
  return commands;
}

function findReadyJobs<Job extends RuntimeDagNode>(
  jobs: readonly Job[],
  completed: ReadonlyMap<string, RuntimeCompletionStatus>,
  running: ReadonlySet<string>,
): readonly Job[] {
  return jobs.filter(
    (job) =>
      job.mode !== 'listening' &&
      !completed.has(job.key) &&
      !running.has(job.key) &&
      job.dependencies.every((dependency) => completed.get(dependency) === 'succeeded'),
  );
}

function findBlockedJobs<Job extends RuntimeDagNode>(
  jobs: readonly Job[],
  completed: ReadonlyMap<string, RuntimeCompletionStatus>,
): readonly Job[] {
  return jobs.filter(
    (job) =>
      job.mode !== 'listening' &&
      !completed.has(job.key) &&
      job.dependencies.some((dependency) => completed.get(dependency) === 'failed'),
  );
}

function hasFailure(completed: ReadonlyMap<string, RuntimeCompletionStatus>): boolean {
  return Array.from(completed.values()).some((status) => status === 'failed');
}
