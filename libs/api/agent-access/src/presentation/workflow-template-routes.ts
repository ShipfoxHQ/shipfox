import {
  listWorkspaceWorkflowTemplatesResponseSchema,
  type WorkspaceWorkflowTemplateDto,
} from '@shipfox/api-agent-access-dto';
import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {buildTemplatePrompt, type TemplateLoader} from '@shipfox/workflow-templates';
import {z} from 'zod';
import {
  listWorkspaceTemplates,
  rankWorkspaceTemplates,
  type WorkspaceTemplate,
} from '#core/workspace-templates.js';

export interface CreateWorkflowTemplateRoutesOptions {
  templates: TemplateLoader;
  integrations: IntegrationsModuleClient;
}

export function createWorkflowTemplateRoutes(
  options: CreateWorkflowTemplateRoutesOptions,
): RouteGroup {
  return {
    prefix: '/workspaces/:workspaceId',
    auth: AUTH_USER,
    routes: [
      defineRoute({
        method: 'GET',
        path: '/workflow-templates',
        description: 'List workflow templates grouped and ranked for the workspace connections',
        schema: {
          params: z.object({workspaceId: z.string().uuid()}),
          response: {200: listWorkspaceWorkflowTemplatesResponseSchema},
        },
        handler: async (request) => {
          const {workspaceId} = request.params;
          requireWorkspaceAccess({request, workspaceId});

          const templates = await listWorkspaceTemplates({...options, workspaceId});
          return {templates: rankWorkspaceTemplates(templates).map(toWorkflowTemplateDto)};
        },
      }),
    ],
  };
}

function toWorkflowTemplateDto({
  template,
  roles,
  group,
  missingProviders,
}: WorkspaceTemplate): WorkspaceWorkflowTemplateDto {
  const {manifest} = template;
  // Required roles first, so the providers a template cannot run without lead.
  const orderedRoles = [
    ...roles.filter(({declaration}) => declaration.optional !== true),
    ...roles.filter(({declaration}) => declaration.optional === true),
  ];
  return {
    id: template.id,
    title: manifest.title,
    summary: manifest.summary,
    group,
    start_label: template.startsManually ? null : manifest.starts,
    providers: [...new Set(orderedRoles.flatMap(({declaration}) => declaration.providers))],
    missing_providers: missingProviders,
    prompt: buildTemplatePrompt({templateId: template.id}),
  };
}
