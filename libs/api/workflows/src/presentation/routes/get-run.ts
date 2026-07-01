import {workflowRunDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkflowRunDetail} from '#db/index.js';
import {
  toJobDto,
  toJobExecutionDto,
  toRunAttemptDto,
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
    querystring: z.object({
      attempt: z.coerce.number().int().positive().optional(),
    }),
    response: {
      200: workflowRunDetailResponseSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;
    await requireAccessibleRun({request, id});

    const run = await getWorkflowRunDetail(id, request.query.attempt);
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
      ...toRunDto(run, run.latestAttempt),
      run_attempt: toRunAttemptDto(run.runAttempt),
      jobs: jobDtos,
    };
  },
});
