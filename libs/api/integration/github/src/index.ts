import type {
  GetIntegrationConnectionByIdFn,
  PublishSourcePushFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-core-dto';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createGithubApiClient, type GithubApiClient} from '#api/client.js';
import {GithubSourceControlProvider} from '#core/source-control.js';
import {closeDb, db} from '#db/db.js';
import {getGithubInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
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
export type {HandleGithubPushOutcome} from '#core/webhook.js';
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
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  getGithubInstallationByConnectionId?: typeof getGithubInstallationByConnectionId | undefined;
}

export function createGithubIntegrationProvider(options: CreateGithubIntegrationProviderOptions) {
  const github = options.github ?? createGithubApiClient();
  const getInstallationByConnectionId =
    options.getGithubInstallationByConnectionId ?? getGithubInstallationByConnectionId;

  return {
    provider: 'github' as const,
    displayName: 'GitHub',
    adapters: {
      source_control: new GithubSourceControlProvider(github),
    },
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation) return undefined;
      const installationId = encodeURIComponent(installation.installationId);
      if (installation.accountType === 'Organization') {
        const login = encodeURIComponent(installation.accountLogin);
        return `https://github.com/organizations/${login}/settings/installations/${installationId}`;
      }
      return `https://github.com/settings/installations/${installationId}`;
    },
    routes: [
      createGithubIntegrationRoutes({
        github,
        getExistingGithubConnection: options.getExistingGithubConnection,
        connectGithubInstallation: options.connectGithubInstallation,
      }),
      createGithubWebhookRoutes({
        coreDb: options.coreDb,
        publishSourcePush: options.publishSourcePush,
        recordDeliveryOnly: options.recordDeliveryOnly,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
      }),
    ],
  };
}
