import {requireProjectAccess} from '@shipfox/api-projects';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {getWorkflowRunById} from '#db/index.js';

export async function requireAccessibleRun({
  request,
  id,
}: {
  request: FastifyRequest;
  id: string;
}): Promise<WorkflowRun> {
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

  return run;
}
