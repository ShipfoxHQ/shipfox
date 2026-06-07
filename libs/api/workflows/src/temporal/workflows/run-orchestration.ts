import {executeChild, proxyActivities} from '@temporalio/workflow';

import type {CompletionStatus} from '#core/dag.js';
import type {RuntimeCommand} from '#core/runtime/runtime-command.js';
import {createInitialRuntimeState, type RuntimeState} from '#core/runtime/runtime-state.js';
import {transitionRuntimeState} from '#core/runtime/transition.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import type {DagJob} from '../activities/orchestration-activities.js';
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
  const jobVersions = new Map<string, number>();
  const jobsById = new Map<string, DagJob>();
  for (const job of dag.jobs) {
    jobVersions.set(job.id, job.version);
    jobsById.set(job.id, job);
  }

  let runtimeState = createInitialRuntimeState({
    jobs: dag.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      dependencies: job.dependencies,
    })),
  });

  const {newVersion} = await setRunStatus({
    runId: input.runId,
    status: 'running',
    version: runVersion,
  });
  runVersion = newVersion;

  const started = transitionRuntimeState(runtimeState, {type: 'run_started'});
  runtimeState = started.state;
  await applyRuntimeCommands(started.commands, {
    input,
    jobsById,
    jobVersions,
    getRuntimeState: () => runtimeState,
    setRuntimeState: (state) => {
      runtimeState = state;
    },
    getRunVersion: () => runVersion,
    setRunVersion: (version) => {
      runVersion = version;
    },
  });
}

interface RuntimeCommandContext {
  input: RunOrchestrationInput;
  jobsById: ReadonlyMap<string, DagJob>;
  jobVersions: Map<string, number>;
  getRuntimeState: () => RuntimeState;
  setRuntimeState: (state: RuntimeState) => void;
  getRunVersion: () => number;
  setRunVersion: (version: number) => void;
}

type StartJobCommand = Extract<RuntimeCommand, {type: 'start_job'}>;

async function applyRuntimeCommands(
  commands: RuntimeCommand[],
  context: RuntimeCommandContext,
): Promise<void> {
  const startCommands: StartJobCommand[] = [];

  for (const command of commands) {
    switch (command.type) {
      case 'cancel_job': {
        const job = getDagJob(command.jobId, context.jobsById);
        const version = context.jobVersions.get(job.id) ?? job.version;
        const {newVersion} = await setJobStatus({
          jobId: job.id,
          status: 'cancelled',
          version,
        });
        context.jobVersions.set(job.id, newVersion);
        break;
      }
      case 'start_job':
        startCommands.push(command);
        break;
      case 'complete_run': {
        const {newVersion} = await setRunStatus({
          runId: context.input.runId,
          status: command.status,
          version: context.getRunVersion(),
        });
        context.setRunVersion(newVersion);
        break;
      }
    }
  }

  if (startCommands.length === 0) return;

  const jobs = startCommands.map((command) => getDagJob(command.jobId, context.jobsById));
  const results = await launchJobs(jobs, context.input, context.jobVersions);

  for (const [job, result] of jobs.map(
    (candidate, index) => [candidate, results[index]] as const,
  )) {
    if (!result) continue;
    context.jobVersions.set(job.id, result.jobVersion);

    const next = transitionRuntimeState(context.getRuntimeState(), {
      type: 'job_completed',
      jobId: job.id,
      status: result.status,
    });
    context.setRuntimeState(next.state);
    await applyRuntimeCommands(next.commands, context);
  }
}

interface LaunchResult {
  status: CompletionStatus;
  jobVersion: number;
}

function launchJobs(
  jobs: DagJob[],
  input: RunOrchestrationInput,
  jobVersions: Map<string, number>,
): Promise<LaunchResult[]> {
  return Promise.all(
    jobs.map(async (job) => {
      const result = await executeChild(jobOrchestration, {
        workflowId: `job:${job.id}`,
        args: [
          {
            workspaceId: input.workspaceId,
            jobId: job.id,
            runId: input.runId,
            jobName: job.name,
            jobVersion: jobVersions.get(job.id) ?? job.version,
            steps: job.steps,
          },
        ],
      });
      return {status: result.status, jobVersion: result.jobVersion};
    }),
  );
}

function getDagJob(jobId: string, jobsById: ReadonlyMap<string, DagJob>): DagJob {
  const job = jobsById.get(jobId);
  if (!job) {
    throw new Error(`Runtime command referenced unknown job: ${jobId}`);
  }
  return job;
}
