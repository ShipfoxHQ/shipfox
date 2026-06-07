import type {RuntimeCommand} from './runtime-command.js';
import type {RuntimeEvent} from './runtime-event.js';
import type {RuntimeJobState, RuntimeState} from './runtime-state.js';

export interface RuntimeTransitionResult {
  state: RuntimeState;
  commands: RuntimeCommand[];
}

export function transitionRuntimeState(
  state: RuntimeState,
  event: RuntimeEvent,
): RuntimeTransitionResult {
  if (isTerminalRun(state)) {
    return {state: cloneState(state), commands: []};
  }

  switch (event.type) {
    case 'run_started': {
      const nextState = cloneState(state);
      nextState.run.status = 'running';
      return reconcileRuntimeState(nextState);
    }
    case 'job_completed': {
      const nextState = cloneState(state);
      const job = nextState.jobs.find((candidate) => candidate.id === event.jobId);
      if (!job || !isRunning(job)) {
        return {state: nextState, commands: []};
      }
      job.status = event.status;
      return reconcileRuntimeState(nextState);
    }
  }
}

function reconcileRuntimeState(state: RuntimeState): RuntimeTransitionResult {
  const commands: RuntimeCommand[] = [];

  // The kernel receives normalized IR that already passed static semantics, so
  // dependency names are expected to be closed and acyclic. The no-progress
  // guard below still fails malformed states instead of leaving them stuck.
  let cancelledJob = findBlockedPendingJob(state);
  while (cancelledJob) {
    cancelledJob.status = 'cancelled';
    commands.push({type: 'cancel_job', jobId: cancelledJob.id});
    cancelledJob = findBlockedPendingJob(state);
  }

  let startedJob = false;
  for (const job of state.jobs) {
    if (isReadyPendingJob(state, job)) {
      job.status = 'running';
      startedJob = true;
      commands.push({type: 'start_job', jobId: job.id});
    }
  }

  if (!startedJob && state.jobs.some(isPendingJob) && !state.jobs.some(isRunning)) {
    for (const job of state.jobs) {
      if (isPendingJob(job)) {
        job.status = 'cancelled';
        commands.push({type: 'cancel_job', jobId: job.id});
      }
    }
  }

  if (state.jobs.every(isTerminalJob)) {
    const failed = state.jobs.some((job) => job.status === 'failed' || job.status === 'cancelled');
    state.run.status = failed ? 'failed' : 'succeeded';
    commands.push({type: 'complete_run', status: state.run.status});
  }

  return {state, commands};
}

function findBlockedPendingJob(state: RuntimeState): RuntimeJobState | undefined {
  return state.jobs.find(
    (job) =>
      job.status === 'pending' &&
      job.dependencies.some((dependencyName) => {
        const dependency = state.jobs.find((candidate) => candidate.name === dependencyName);
        return dependency?.status === 'failed' || dependency?.status === 'cancelled';
      }),
  );
}

function isReadyPendingJob(state: RuntimeState, job: RuntimeJobState): boolean {
  return (
    job.status === 'pending' &&
    job.dependencies.every((dependencyName) => {
      const dependency = state.jobs.find((candidate) => candidate.name === dependencyName);
      return dependency?.status === 'succeeded';
    })
  );
}

function isRunning(job: RuntimeJobState): boolean {
  return job.status === 'running';
}

function isPendingJob(job: RuntimeJobState): boolean {
  return job.status === 'pending';
}

function isTerminalJob(job: RuntimeJobState): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled';
}

function isTerminalRun(state: RuntimeState): boolean {
  return state.run.status === 'succeeded' || state.run.status === 'failed';
}

function cloneState(state: RuntimeState): RuntimeState {
  return {
    run: {...state.run},
    jobs: state.jobs.map((job) => ({...job, dependencies: [...job.dependencies]})),
  };
}
