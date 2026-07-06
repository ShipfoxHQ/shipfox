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
  const running = input.running ?? new Set();

  let skipped: readonly Job[];
  do {
    skipped = findDefaultSkippedJobs(input.jobs, completed, running);
    for (const job of skipped) {
      commands.push({kind: 'skip-job', job, statusReason: 'default_gate_rejected'});
      completed.set(job.key, 'skipped');
    }
  } while (skipped.length > 0);

  const activationCandidates = findActivationCandidates(input.jobs, completed, running);
  if (activationCandidates.length > 0) {
    commands.push({kind: 'evaluate-job-activation', jobs: activationCandidates});
  }

  const ready = findReadyJobs(input.jobs, completed, running);
  if (ready.length > 0) {
    commands.push(...ready.map((job): RuntimeSchedulingCommand<Job> => ({kind: 'start-job', job})));
    return commands;
  }
  if (activationCandidates.length > 0) return commands;

  if (input.jobs.some((job) => running.has(job.key) && !completed.has(job.key))) {
    return commands;
  }

  const remaining = input.jobs.filter((job) => !completed.has(job.key));

  if (remaining.length > 0) {
    commands.push(
      ...remaining.map(
        (job): RuntimeSchedulingCommand<Job> => ({
          kind: 'skip-job',
          job,
          statusReason: 'default_gate_rejected',
        }),
      ),
    );
    for (const job of remaining) completed.set(job.key, 'skipped');
    commands.push({kind: 'complete-run', status: hasFailure(completed) ? 'failed' : 'succeeded'});
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
      !completed.has(job.key) &&
      !running.has(job.key) &&
      !hasActivationCondition(job) &&
      job.dependencies.every((dependency) => completed.get(dependency) === 'succeeded'),
  );
}

function findDefaultSkippedJobs<Job extends RuntimeDagNode>(
  jobs: readonly Job[],
  completed: ReadonlyMap<string, RuntimeCompletionStatus>,
  running: ReadonlySet<string>,
): readonly Job[] {
  return jobs.filter(
    (job) =>
      !completed.has(job.key) &&
      !running.has(job.key) &&
      !hasActivationCondition(job) &&
      job.dependencies.every((dependency) => completed.has(dependency)) &&
      job.dependencies.some((dependency) => completed.get(dependency) !== 'succeeded'),
  );
}

function findActivationCandidates<Job extends RuntimeDagNode>(
  jobs: readonly Job[],
  completed: ReadonlyMap<string, RuntimeCompletionStatus>,
  running: ReadonlySet<string>,
): readonly Job[] {
  return jobs.filter(
    (job) =>
      !completed.has(job.key) &&
      !running.has(job.key) &&
      hasActivationCondition(job) &&
      job.dependencies.every((dependency) => completed.has(dependency)),
  );
}

function hasFailure(completed: ReadonlyMap<string, RuntimeCompletionStatus>): boolean {
  return Array.from(completed.values()).some((status) => status === 'failed');
}

function hasActivationCondition(job: RuntimeDagNode): boolean {
  return job.hasActivationCondition === true;
}
