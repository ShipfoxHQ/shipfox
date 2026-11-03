import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {backfillDefaultProjectsResponseSchema} from '@shipfox/api-projects-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {backfillDefaultProjects} from '#core/index.js';

const minimumRole = 'admin-operator' as const;

export function createBackfillDefaultProjectsRoute(deps: {
  auth: Pick<AuthInterModuleClient, 'requireAdminRole'>;
  workspaces: Pick<WorkspacesInterModuleClient, 'listAdminWorkspaces'>;
  integrations: IntegrationsModuleClient;
}) {
  return defineRoute({
    method: 'POST',
    path: '/default-backfill',
    auth: AUTH_USER,
    description:
      'Give every workspace that is not deleted a default project, and fill the missing config repository owners, names, and default branches. Safe to run again.',
    schema: {
      response: {200: backfillDefaultProjectsResponseSchema},
    },
    errorHandler: (error) => {
      if (
        isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error) &&
        error.code === 'admin-role-required'
      ) {
        throw new ClientError('Administrator operator role required', 'forbidden', {
          status: 403,
          details: {required_role: error.details.requiredRole},
        });
      }
      throw error;
    },
    handler: async (request) => {
      const actor = requireUserContext(request);
      await deps.auth.requireAdminRole({userId: actor.userId, minimumRole});

      const result = await backfillDefaultProjects({
        actorId: actor.userId,
        workspaces: deps.workspaces,
        integrations: deps.integrations,
      });
      return {
        workspaces_checked: result.workspacesChecked,
        defaults_created: result.defaultsCreated,
        repositories_filled: result.repositoriesFilled,
        failures: result.failures,
      };
    },
  });
}
