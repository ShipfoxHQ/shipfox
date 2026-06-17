import type {RunDetailResponseDto} from '@shipfox/api-workflows-dto';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {getJobsByRunId, getStepAttemptsByJobIds, getStepsByJobIds} from '#db/index.js';
import {toJobDto} from './job.js';
import {toStepAttemptDto, toStepDto} from './step.js';
import {toRunDto} from './workflow-run.js';

export async function toRunDetailDto(run: WorkflowRun): Promise<RunDetailResponseDto> {
  const runJobs = await getJobsByRunId(run.id);
  const jobIds = runJobs.map((j) => j.id);
  const [allSteps, allAttempts] = await Promise.all([
    getStepsByJobIds(jobIds),
    getStepAttemptsByJobIds(jobIds),
  ]);

  const stepsByJobId = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    const steps = stepsByJobId.get(step.jobId) ?? [];
    steps.push(step);
    stepsByJobId.set(step.jobId, steps);
  }

  const attemptsByStepId = new Map<string, typeof allAttempts>();
  for (const attempt of allAttempts) {
    const attempts = attemptsByStepId.get(attempt.stepId) ?? [];
    attempts.push(attempt);
    attemptsByStepId.set(attempt.stepId, attempts);
  }

  const jobDtos = runJobs.map((job) => ({
    ...toJobDto(job),
    steps: (stepsByJobId.get(job.id) ?? []).map((step) => ({
      ...toStepDto(step),
      attempts: (attemptsByStepId.get(step.id) ?? []).map(toStepAttemptDto),
    })),
  }));

  return {
    ...toRunDto(run),
    jobs: jobDtos,
  };
}
