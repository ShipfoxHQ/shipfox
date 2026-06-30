import {runDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  getJobExecutionsByRunId,
  getJobsByRunId,
  getLatestAttempt,
  getStepAttemptsByJobIds,
  getStepsByJobExecutionIds,
} from '#db/index.js';
import {
  toJobDto,
  toJobExecutionDto,
  toRunDto,
  toStepAttemptDto,
  toStepDto,
} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';

export const getRunRoute = defineRoute({
  method: 'GET',
  path: '/:id',
  description: 'Get a workflow run by ID with jobs and steps',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: runDetailResponseSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;
    const run = await requireAccessibleRun({request, id});

    const runJobs = await getJobsByRunId(run.id);
    const jobIds = runJobs.map((j) => j.id);
    const jobExecutions = await getJobExecutionsByRunId(run.id);
    const jobExecutionIds = jobExecutions.map((jobExecution) => jobExecution.id);
    const [allSteps, allAttempts] = await Promise.all([
      getStepsByJobExecutionIds(jobExecutionIds),
      getStepAttemptsByJobIds(jobIds),
    ]);

    const jobDtos = runJobs.map((job) => ({
      ...toJobDto(job),
      executions: jobExecutions
        .filter((jobExecution) => jobExecution.jobId === job.id)
        .map((jobExecution) => ({
          ...toJobExecutionDto(jobExecution),
          steps: allSteps
            .filter((s) => s.executionId === jobExecution.id)
            .map((step) => ({
              ...toStepDto(step),
              attempts: allAttempts.filter((a) => a.stepId === step.id).map(toStepAttemptDto),
            })),
        })),
    }));

    return {
      ...toRunDto(run),
      latest_attempt:
        run.rootRunId !== null || run.attempt > 1
          ? await getLatestAttempt({rootRunId: run.rootRunId ?? run.id, projectId: run.projectId})
          : run.attempt,
      jobs: jobDtos,
    };
  },
});
