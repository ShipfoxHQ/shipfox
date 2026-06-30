import {
  condition,
  defineSignal,
  executeChild,
  ParentClosePolicy,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';

import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';
import {scheduleRuntimeDag} from '#core/workflow-runtime/schedule-runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import type {DagJob, RunDag} from '../activities/orchestration-activities.js';
import {RUN_CANCEL_SIGNAL} from '../constants.js';
import {jobOrchestration} from './job-orchestration.js';

const {loadRunDag, setRunStatus, setJobStatus, cancelRunnerJobsActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
});

export const runCancelSignal = defineSignal<[]>(RUN_CANCEL_SIGNAL);

export interface RunOrchestrationInput {
  runId: string;
  workspaceId: string;
}

export async function runOrchestration(input: RunOrchestrationInput): Promise<void> {
  let cancelRequested = false;
  setHandler(runCancelSignal, () => {
    cancelRequested = true;
  });

  const dag = await loadRunDag(input.runId);

  let runVersion = dag.runVersion;
  const {newVersion, status} = await setRunStatus({
    runId: input.runId,
    status: 'running',
    version: runVersion,
  });
  runVersion = newVersion;
  if (status !== undefined && status !== 'pending' && status !== 'running') return;

  const completed = new Map<string, RuntimeCompletionStatus>();
  const jobVersions = new Map<string, number>();
  for (const job of dag.jobs) {
    jobVersions.set(job.id, job.version);
    if (job.status === 'succeeded') completed.set(job.name, 'succeeded');
  }

  while (true) {
    if (cancelRequested) {
      await cancelNonCompletedRunnerJobs(dag, completed);
      return;
    }

    const commands = scheduleRuntimeDag({jobs: dag.jobs, completed});
    const completeRun = commands.find((command) => command.kind === 'complete-run');

    for (const command of commands) {
      if (command.kind !== 'skip-job') continue;
      await skipJob(command.job, completed, jobVersions);
    }

    const jobsToStart = commands.flatMap((command) =>
      command.kind === 'start-job' ? [command.job] : [],
    );
    const outcome = await launchJobsUntilCancel(
      jobsToStart,
      dag,
      jobVersions,
      () => cancelRequested,
    );
    if (outcome.kind === 'cancelled') {
      await cancelNonCompletedRunnerJobs(dag, completed);
      return;
    }
    const results = outcome.results;
    for (const [job, result] of jobsToStart.map((j, i) => [j, results[i]] as const)) {
      if (!result) continue;
      completed.set(job.name, result.status);
      jobVersions.set(job.id, result.jobVersion);
    }

    if (completeRun) {
      await setRunStatus({
        runId: input.runId,
        status: completeRun.status,
        version: runVersion,
      });
      return;
    }
  }
}

async function skipJob(
  job: DagJob,
  completed: Map<string, RuntimeCompletionStatus>,
  jobVersions: Map<string, number>,
): Promise<void> {
  const version = jobVersions.get(job.id) ?? job.version;
  const {newVersion} = await setJobStatus({
    jobId: job.id,
    status: 'skipped',
    version,
    statusReason: 'dependency_not_completed',
  });
  jobVersions.set(job.id, newVersion);
  completed.set(job.name, 'failed');
}

interface LaunchResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

function launchJobs(
  jobs: DagJob[],
  run: RunDag,
  jobVersions: Map<string, number>,
): Promise<LaunchResult[]> {
  return Promise.all(
    jobs.map(async (job) => {
      const result = await executeChild(jobOrchestration, {
        workflowId: `job:${job.id}`,
        args: [
          {
            workspaceId: run.workspaceId,
            projectId: run.projectId,
            jobId: job.id,
            executionId: job.executionId,
            runId: run.runId,
            jobVersion: jobVersions.get(job.id) ?? job.version,
            executionVersion: job.executionVersion ?? jobVersions.get(job.id) ?? job.version,
            ...(job.executionTimeoutMs === undefined
              ? {}
              : {executionTimeoutMs: job.executionTimeoutMs}),
            requiredLabels: job.runner,
          },
        ],
        parentClosePolicy: ParentClosePolicy.TERMINATE,
      });
      return {status: result.status, jobVersion: result.jobVersion};
    }),
  );
}

async function launchJobsUntilCancel(
  jobs: DagJob[],
  run: RunDag,
  jobVersions: Map<string, number>,
  isCancelRequested: () => boolean,
): Promise<{kind: 'completed'; results: LaunchResult[]} | {kind: 'cancelled'}> {
  if (jobs.length === 0) return {kind: 'completed', results: []};
  const results = launchJobs(jobs, run, jobVersions);
  const cancel = condition(isCancelRequested).then(() => ({kind: 'cancelled' as const}));
  return await Promise.race([
    results.then((value) => ({kind: 'completed' as const, results: value})),
    cancel,
  ]);
}

async function cancelNonCompletedRunnerJobs(
  dag: RunDag,
  completed: Map<string, RuntimeCompletionStatus>,
): Promise<void> {
  const jobIds = dag.jobs.filter((job) => !completed.has(job.name)).map((job) => job.id);
  await cancelRunnerJobsActivity({jobIds});
}
