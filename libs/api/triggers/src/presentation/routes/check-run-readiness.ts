import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {runReadinessQuerySchema, runReadinessResponseSchema} from '@shipfox/api-triggers-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {checkTriggerSecretReadiness, subscriptionMapsSecrets} from '#core/trigger-run-readiness.js';
import {listSubscriptionsByWorkflowDefinitionIds} from '#db/subscriptions.js';
import {toRunIssueDto} from '#presentation/dto/run-readiness.js';
import {requireProjectAccess} from './project-access.js';

export function createCheckRunReadinessRoute(
  workflows: WorkflowsModuleClient,
  projects: ProjectsModuleClient,
  secrets: Pick<SecretsInterModuleClient, 'listSecretNames'>,
) {
  return defineRoute({
    method: 'GET',
    path: '/readiness',
    description:
      'Report what each workflow definition still needs before its runs can start cleanly. Advisory: run creation stays the authority.',
    schema: {
      querystring: runReadinessQuerySchema,
      response: {
        200: runReadinessResponseSchema,
      },
    },
    handler: async (request) => {
      const {project_id: projectId, definition_id: definitionIds} = request.query;
      const {workspaceId} = await requireProjectAccess(request, projectId, projects);

      const {definitions} = await workflows.checkRunReadiness({
        workspaceId,
        projectId,
        definitionIds,
      });

      const subscriptions = (
        await listSubscriptionsByWorkflowDefinitionIds(definitions.map((d) => d.definitionId))
      ).filter((subscription) => subscription.projectId === projectId);
      const definedSecretNames = subscriptions.some(subscriptionMapsSecrets)
        ? await listDefinedSecretNames(secrets, {workspaceId, projectId})
        : new Set<string>();

      return {
        definitions: definitions.map(({definitionId, issues, secretInputs}) => {
          const triggerIssues = subscriptions
            .filter((subscription) => subscription.workflowDefinitionId === definitionId)
            .flatMap((subscription) =>
              checkTriggerSecretReadiness({subscription, secretInputs, definedSecretNames}),
            );
          return {
            definition_id: definitionId,
            // An issue that refuses the start leads, so the Setup list opens on what stops runs.
            issues: [...issues, ...triggerIssues]
              .sort(
                (a, b) => Number(b.effect === 'blocks-start') - Number(a.effect === 'blocks-start'),
              )
              .map(toRunIssueDto),
          };
        }),
      };
    },
  });
}

/** A run resolves a secret at project scope first, then workspace, so either scope defines it. */
async function listDefinedSecretNames(
  secrets: Pick<SecretsInterModuleClient, 'listSecretNames'>,
  params: {workspaceId: string; projectId: string},
): Promise<Set<string>> {
  const scopes = [{workspaceId: params.workspaceId}, params];
  const results = await Promise.all(scopes.map((scope) => secrets.listSecretNames(scope)));
  return new Set(results.flatMap(({names}) => names));
}
