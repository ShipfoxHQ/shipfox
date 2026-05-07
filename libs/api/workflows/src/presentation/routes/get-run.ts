import {requireProjectAccess} from '@shipfox/api-projects';
import {jobDtoSchema, runResponseSchema, stepDtoSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getJobsByRunId, getStepsByJobIds, getWorkflowRunById} from '#db/index.js';
import {toJobDto, toRunDto, toStepDto} from '#presentation/dto/index.js';

const runDetailResponseSchema = runResponseSchema.extend({
  jobs: z.array(
    jobDtoSchema.extend({
      steps: z.array(stepDtoSchema),
    }),
  ),
});

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

    const run = await getWorkflowRunById(id);
    if (!run) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }

    await requireProjectAccess({request, projectId: run.projectId}).catch(() => {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    });

    const runJobs = await getJobsByRunId(run.id);
    const allSteps = await getStepsByJobIds(runJobs.map((j) => j.id));

    const jobDtos = runJobs.map((job) => ({
      ...toJobDto(job),
      steps: allSteps.filter((s) => s.jobId === job.id).map(toStepDto),
    }));

    return {
      ...toRunDto(run),
      jobs: jobDtos,
    };
  },
});
