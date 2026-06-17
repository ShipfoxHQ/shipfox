import {executeChild, proxyActivities} from '@temporalio/workflow';

import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';
import {scheduleRuntimeDag} from '#core/workflow-runtime/index.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import type {DagJob, RunDag} from '../activities/orchestration-activities.js';
import {jobOrchestration} from './job-orchestration.js';

const {loadRunDag, setRunStatus, setJobStatus} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
});

export interface RunOrchestrationInput {
  runId: string;
  workspaceId: string;
}

export async function runOrchestration(input: RunOrchestrationInput): Promise<void> {
  const dag = await loadRunDag(input.runId);

  let runVersion = dag.runVersion;
  const {newVersion} = await setRunStatus({
    runId: input.runId,
    status: 'running',
    version: runVersion,
  });
  runVersion = newVersion;

  const completed = new Map<string, RuntimeCompletionStatus>();
  const jobVersions = new Map<string, number>();
  for (const job of dag.jobs) {
    jobVersions.set(job.id, job.version);
  }

  while (true) {
    const commands = scheduleRuntimeDag({jobs: dag.jobs, completed});
    const completeRun = commands.find((command) => command.kind === 'complete-run');

    for (const command of commands) {
      if (command.kind !== 'cancel-job') continue;
      await cancelJob(command.job, completed, jobVersions);
    }

    const jobsToStart = commands.flatMap((command) =>
      command.kind === 'start-job' ? [command.job] : [],
    );
    const results = await launchJobs(jobsToStart, dag, jobVersions);
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

async function cancelJob(
  job: DagJob,
  completed: Map<string, RuntimeCompletionStatus>,
  jobVersions: Map<string, number>,
): Promise<void> {
  const version = jobVersions.get(job.id) ?? job.version;
  const {newVersion} = await setJobStatus({jobId: job.id, status: 'cancelled', version});
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
            runId: run.runId,
            jobVersion: jobVersions.get(job.id) ?? job.version,
          },
        ],
      });
      return {status: result.status, jobVersion: result.jobVersion};
    }),
  );
}
