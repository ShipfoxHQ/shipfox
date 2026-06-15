import {requireProjectAccess} from '@shipfox/api-projects';
import {runDetailDtoSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  getJobsByRunId,
  getStepAttemptsByJobIds,
  getStepsByJobIds,
  getWorkflowRunById,
} from '#db/index.js';
import {toJobDto, toRunDto, toStepAttemptDto, toStepDto} from '#presentation/dto/index.js';

export const getRunRoute = defineRoute({
  method: 'GET',
  path: '/:id',
  description: 'Get a workflow run by ID with jobs and steps',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: runDetailDtoSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;

    const run = await getWorkflowRunById(id);
    if (!run) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }

    await requireProjectAccess({request, projectId: run.projectId}).catch((err: unknown) => {
      if (err instanceof ClientError && (err.status === 403 || err.status === 404)) {
        throw new ClientError('Run not found', 'not-found', {status: 404});
      }
      throw err;
    });

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
  },
});
