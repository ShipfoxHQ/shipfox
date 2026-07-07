import {
  createDefinitionBodySchema,
  definitionResponseSchema,
  definitionValidationErrorSchema,
} from '@shipfox/api-definitions-dto';
import {ProjectNotFoundError, requireProjectAccess} from '@shipfox/api-projects';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {
  AgentToolSelectionCatalogs,
  LoadWorkspaceConnectionSnapshot,
} from '#core/entities/integration-context.js';
import {DefinitionParseError} from '#core/errors.js';
import {parseDefinition} from '#core/parse-definition.js';
import {upsertDefinition} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';

export interface CreateDefinitionRouteOptions {
  agentToolSelectionCatalogs?: AgentToolSelectionCatalogs | undefined;
  loadWorkspaceConnectionSnapshot?: LoadWorkspaceConnectionSnapshot | undefined;
}

export function buildCreateDefinitionRoute(options: CreateDefinitionRouteOptions = {}) {
  return defineRoute({
    method: 'POST',
    path: '/',
    description: 'Create or update a workflow definition',
    schema: {
      body: createDefinitionBodySchema,
      response: {
        200: definitionResponseSchema,
        400: z.object({
          code: z.string(),
          message: z.string().optional(),
          details: z.array(definitionValidationErrorSchema).optional(),
        }),
        404: z.object({code: z.string()}),
      },
    },
    errorHandler: (error, _request, _reply) => {
      if (error instanceof DefinitionParseError) {
        throw new ClientError(error.message, 'invalid-workflow-definition', {
          details: error.details,
          status: 400,
        });
      }
      if (error instanceof ProjectNotFoundError) {
        throw new ClientError(error.message, 'project-not-found', {status: 404});
      }
      throw error;
    },
    handler: async (request) => {
      const {project_id: projectId, config_path, source, yaml: yamlString, sha, ref} = request.body;
      const {project} = await requireProjectAccess({request, projectId});

      const integrationValidationContext =
        options.agentToolSelectionCatalogs === undefined ||
        options.loadWorkspaceConnectionSnapshot === undefined
          ? undefined
          : {
              agentToolSelectionCatalogs: options.agentToolSelectionCatalogs,
              workspaceConnectionSnapshot: await options.loadWorkspaceConnectionSnapshot(
                project.workspaceId,
              ),
            };
      const parsed =
        integrationValidationContext === undefined
          ? parseDefinition(yamlString)
          : parseDefinition(yamlString, {integrationValidationContext});

      const definition = await upsertDefinition({
        projectId,
        workspaceId: project.workspaceId,
        configPath: config_path,
        source,
        name: parsed.document.name,
        document: parsed.document,
        model: parsed.model,
        sourceSnapshot: parsed.sourceSnapshot,
        sha,
        ref,
      });

      return toDefinitionDto(definition);
    },
  });
}

export const createDefinitionRoute = buildCreateDefinitionRoute();
