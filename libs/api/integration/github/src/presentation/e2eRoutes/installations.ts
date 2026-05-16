import {
  e2eCreateGithubInstallationBodySchema,
  e2eCreateGithubInstallationResponseSchema,
} from '@shipfox/api-integration-github-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {upsertGithubInstallation} from '#db/installations.js';

export const createE2eGithubInstallationRoute = defineRoute({
  method: 'POST',
  path: '/installations',
  description: 'Seed a GitHub App installation for E2E tests.',
  schema: {
    body: e2eCreateGithubInstallationBodySchema,
    response: {
      201: e2eCreateGithubInstallationResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const installation = await upsertGithubInstallation({
      connectionId: request.body.connection_id,
      installationId: request.body.installation_id,
      accountLogin: request.body.account_login ?? 'e2e-account',
      accountType: request.body.account_type ?? 'Organization',
      repositorySelection: request.body.repository_selection ?? 'all',
      latestEvent: {source: 'e2e'},
    });

    reply.code(201);
    return {
      installation: {
        id: installation.id,
        connection_id: installation.connectionId,
        installation_id: installation.installationId,
      },
    };
  },
});
