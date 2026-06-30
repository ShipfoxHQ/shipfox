import {runDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getLatestAttempt, getWorkflowRunDetail} from '#db/index.js';
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
    await requireAccessibleRun({request, id});

    const run = await getWorkflowRunDetail(id);
    if (!run) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }

    const jobDtos = run.jobs.map((job) => ({
      ...toJobDto(job),
      job_executions: job.jobExecutions.map((jobExecution) => ({
        ...toJobExecutionDto(jobExecution),
        steps: jobExecution.steps.map((step) => ({
          ...toStepDto(step),
          attempts: step.attempts.map(toStepAttemptDto),
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
