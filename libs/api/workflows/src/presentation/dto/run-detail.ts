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

  const jobDtos = runJobs.map((job) => ({
    ...toJobDto(job),
    steps: allSteps
      .filter((s) => s.jobId === job.id)
      .map((step) => ({
        ...toStepDto(step),
        attempts: allAttempts.filter((a) => a.stepId === step.id).map(toStepAttemptDto),
      })),
  }));

  return {
    ...toRunDto(run),
    jobs: jobDtos,
  };
}
