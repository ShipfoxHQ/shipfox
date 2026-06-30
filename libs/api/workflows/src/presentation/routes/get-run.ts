import {runDetailResponseSchema} from '@shipfox/api-workflows-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  getExecutionsByRunId,
  getJobsByRunId,
  getLatestAttempt,
  getStepAttemptsByJobIds,
  getStepsByExecutionIds,
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
    const executions = await getExecutionsByRunId(run.id);
    const executionIds = executions.map((execution) => execution.id);
    const [allSteps, allAttempts] = await Promise.all([
      getStepsByExecutionIds(executionIds),
      getStepAttemptsByJobIds(jobIds),
    ]);

    const jobDtos = runJobs.map((job) => ({
      ...toJobDto(job),
      executions: executions
        .filter((execution) => execution.jobId === job.id)
        .map((execution) => ({
          ...toJobExecutionDto(execution),
          steps: allSteps
            .filter((s) => s.executionId === execution.id)
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
