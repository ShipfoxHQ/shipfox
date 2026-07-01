import type {RuntimeCompletionStatus, RuntimeDagNode} from './runtime-dag.js';

type RuntimeProgressJob = RuntimeDagNode & {status?: string | undefined};

export interface RuntimeRunProgress {
  completed: Map<string, RuntimeCompletionStatus>;
  jobVersions: Map<string, number>;
}

export interface RuntimeJobResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

export function createRuntimeRunProgress(jobs: readonly RuntimeProgressJob[]): RuntimeRunProgress {
  const completed = new Map<string, RuntimeCompletionStatus>();
  const jobVersions = new Map<string, number>();

  for (const job of jobs) {
    jobVersions.set(job.id, job.version);
    if (job.status === 'succeeded') completed.set(job.key, 'succeeded');
  }

  return {completed, jobVersions};
}

export function runtimeJobVersion(job: RuntimeProgressJob, progress: RuntimeRunProgress): number {
  return progress.jobVersions.get(job.id) ?? job.version;
}

export function recordSkippedRuntimeJob(
  job: RuntimeProgressJob,
  progress: RuntimeRunProgress,
  newVersion: number,
): void {
  progress.jobVersions.set(job.id, newVersion);
  progress.completed.set(job.key, 'failed');
}

export function recordRuntimeJobResult(
  job: RuntimeProgressJob,
  progress: RuntimeRunProgress,
  result: RuntimeJobResult,
): void {
  progress.completed.set(job.key, result.status);
  progress.jobVersions.set(job.id, result.jobVersion);
}

export function nonCompletedRuntimeJobIds(
  jobs: readonly RuntimeProgressJob[],
  progress: RuntimeRunProgress,
): string[] {
  return jobs
    .filter((job) => job.mode !== 'listening' && !progress.completed.has(job.key))
    .map((job) => job.id);
}

export function shouldContinueStartedRun(status: string | undefined): boolean {
  return status === undefined || status === 'pending' || status === 'running';
}
