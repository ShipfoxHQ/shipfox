import {Buffer} from 'node:buffer';
import {
  type DefinitionsInterModuleClient,
  definitionsInterModuleContract,
} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {workflowRunActionFileResponseSchema} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {actionBundleDigestSchema, decodeActionBundle} from '@shipfox/workflow-document';
import {z} from 'zod';
import {workflowRunUsesCompositeAction} from '#db/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';

// The run page shows the manifest that holds a composite action's inner steps.
const COMPOSITE_MANIFEST_PATHS = ['action.yml', 'action.yaml'] as const;

export function getRunActionFileRoute(params: {
  projects: ProjectsModuleClient;
  definitions: DefinitionsInterModuleClient;
}) {
  return defineRoute({
    method: 'GET',
    path: '/:id/action-snapshots/:digest/files/:path',
    description:
      'Get the manifest of a composite action that a workflow run used, read from the action snapshot the run ran.',
    schema: {
      params: z.object({
        id: z.string().uuid(),
        digest: actionBundleDigestSchema,
        path: z.enum(COMPOSITE_MANIFEST_PATHS),
      }),
      response: {
        200: workflowRunActionFileResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (
        isInterModuleKnownError(definitionsInterModuleContract.methods.getActionSnapshot, error)
      ) {
        throw new ClientError('Action file not found', 'not-found', {status: 404, cause: error});
      }
      throw error;
    },
    handler: async (request) => {
      const {id, digest, path} = request.params;
      const run = await requireAccessibleRunScope({request, id, projects: params.projects});
      // Snapshots belong to the workspace, so the run must have used this one.
      if (!(await workflowRunUsesCompositeAction({workflowRunId: id, digest}))) {
        throw new ClientError('Action file not found', 'not-found', {status: 404});
      }

      const snapshot = await params.definitions.getActionSnapshot({
        workspaceId: run.workspaceId,
        digest,
      });
      const files = await decodeActionBundle({
        gzip: Buffer.from(snapshot.bundleGzipBase64, 'base64'),
        digest,
      });
      const file = files.find((candidate) => candidate.path === path);
      if (file === undefined) {
        throw new ClientError('Action file not found', 'not-found', {status: 404});
      }
      return {digest, path, content: file.content};
    },
  });
}
