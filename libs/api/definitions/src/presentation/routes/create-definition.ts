import {
  createDefinitionBodySchema,
  definitionResponseSchema,
  definitionValidationErrorSchema,
} from '@shipfox/api-definitions-dto';
import type {
  AgentToolSelectionCatalogs,
  GetIntegrationConnectionByIdFn,
  LoadWorkspaceConnectionSnapshot,
} from '@shipfox/api-integration-core';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {DefinitionParseError} from '#core/errors.js';
import {hasAgentStepIntegrations} from '#core/has-agent-step-integrations.js';
import {parseDefinition} from '#core/parse-definition.js';
import {upsertDefinition} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';
import {requireProjectAccess} from './project-access.js';

export interface CreateDefinitionRouteOptions {
  projects: ProjectsModuleClient;
  agentToolSelectionCatalogs?: AgentToolSelectionCatalogs | undefined;
  loadWorkspaceConnectionSnapshot?: LoadWorkspaceConnectionSnapshot | undefined;
  getIntegrationConnectionById?: GetIntegrationConnectionByIdFn | undefined;
}

export function buildCreateDefinitionRoute(options: CreateDefinitionRouteOptions) {
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
      throw error;
    },
    handler: async (request) => {
      const {project_id: projectId, config_path, source, yaml: yamlString, sha, ref} = request.body;
      const project = await requireProjectAccess(request, projectId, options.projects);

      const structurallyParsed = parseDefinition(yamlString);
      const {
        agentToolSelectionCatalogs,
        loadWorkspaceConnectionSnapshot,
        getIntegrationConnectionById,
      } = options;
      const parsed =
        agentToolSelectionCatalogs !== undefined &&
        loadWorkspaceConnectionSnapshot !== undefined &&
        hasAgentStepIntegrations(structurallyParsed.document)
          ? parseDefinition(yamlString, {
              integrationValidationContext: {
                agentToolSelectionCatalogs,
                workspaceConnectionSnapshot: await loadWorkspaceConnectionSnapshot(
                  project.workspaceId,
                ),
                defaultConnectionSlug:
                  getIntegrationConnectionById === undefined
                    ? undefined
                    : (await getIntegrationConnectionById(project.sourceConnectionId))?.slug,
              },
            })
          : structurallyParsed;

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
