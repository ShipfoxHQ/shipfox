import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createGithubApiClient, type GithubApiClient} from '#api/client.js';
import {GithubSourceControlProvider} from '#core/source-control.js';
import type {
  GetIntegrationConnectionByIdFn,
  PublishRepositoryPushedFn,
  RecordDeliveryOnlyFn,
} from '#core/webhook.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {githubE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {
  type CreateGithubIntegrationRoutesOptions,
  createGithubIntegrationRoutes,
} from '#presentation/routes/install.js';
import {createGithubWebhookRoutes} from '#presentation/routes/webhooks.js';

export type {GithubApiClient} from '#api/client.js';
export {GithubIntegrationProviderError} from '#core/errors.js';
export type {ConnectGithubInstallationInput} from '#core/install.js';
export {handleGithubCallback} from '#core/install.js';
export {signGithubInstallState, verifyGithubInstallState} from '#core/state.js';
export type {GithubPushPayload, HandleGithubPushOutcome} from '#core/webhook.js';
export {handleGithubPush} from '#core/webhook.js';
export type {GithubInstallation, UpsertGithubInstallationParams} from '#db/installations.js';
export {
  getGithubInstallationByConnectionId,
  getGithubInstallationByInstallationId,
  upsertGithubInstallation,
} from '#db/installations.js';
export {closeDb, db, migrationsPath};

export interface CreateGithubIntegrationProviderOptions
  extends Omit<CreateGithubIntegrationRoutesOptions, 'github'> {
  github?: GithubApiClient | undefined;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishRepositoryPushed: PublishRepositoryPushedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export function createGithubIntegrationProvider(options: CreateGithubIntegrationProviderOptions) {
  const github = options.github ?? createGithubApiClient();

  return {
    provider: 'github' as const,
    displayName: 'GitHub',
    adapters: {
      source_control: new GithubSourceControlProvider(github),
    },
    routes: [
      createGithubIntegrationRoutes({
        github,
        getExistingGithubConnection: options.getExistingGithubConnection,
        connectGithubInstallation: options.connectGithubInstallation,
      }),
      createGithubWebhookRoutes({
        coreDb: options.coreDb,
        publishRepositoryPushed: options.publishRepositoryPushed,
        recordDeliveryOnly: options.recordDeliveryOnly,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
      }),
    ],
    e2eRoutes: [githubE2eRoutes],
  };
}
