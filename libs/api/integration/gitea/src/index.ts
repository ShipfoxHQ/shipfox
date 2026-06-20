import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {giteaProviderKind} from '@shipfox/api-integration-gitea-dto';
import {createGiteaApiClient, type GiteaApiClient} from '#api/client.js';
import {config} from '#config.js';
import type {ConnectGiteaConnectionInput} from '#core/connect.js';
import {GiteaSourceControlProvider} from '#core/source-control.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createGiteaConnectionRoutes} from '#presentation/routes/connections.js';

const TRAILING_SLASHES_RE = /\/+$/;

export type {
  GiteaApiClient,
  GiteaFileContent,
  GiteaRepository,
  GiteaRepositoryPage,
  GiteaTree,
  GiteaTreeBlob,
  GiteaWebhook,
  GiteaWebhookRegistration,
} from '#api/client.js';
export {createGiteaApiClient} from '#api/client.js';
export type {ConnectGiteaConnectionInput} from '#core/connect.js';
export {handleGiteaConnect} from '#core/connect.js';
export {
  GiteaIntegrationProviderError,
  GiteaOrgAlreadyLinkedError,
  GiteaOrganizationNotFoundError,
} from '#core/errors.js';
export {GiteaSourceControlProvider} from '#core/source-control.js';
export type {GiteaConnection, UpsertGiteaConnectionParams} from '#db/connections.js';
export {
  getGiteaConnectionByConnectionId,
  getGiteaConnectionByOrg,
  upsertGiteaConnection,
} from '#db/connections.js';
export {closeDb, db, migrationsPath};

export interface CreateGiteaIntegrationProviderOptions {
  gitea?: GiteaApiClient | undefined;
  getExistingGiteaConnection: (input: {
    org: string;
  }) => Promise<IntegrationConnection<'gitea'> | undefined>;
  connectGiteaConnection: (
    input: ConnectGiteaConnectionInput,
  ) => Promise<IntegrationConnection<'gitea'>>;
}

export function createGiteaIntegrationProvider(options: CreateGiteaIntegrationProviderOptions) {
  const gitea = options.gitea ?? createGiteaApiClient();

  return {
    provider: giteaProviderKind,
    displayName: 'Gitea',
    adapters: {
      source_control: new GiteaSourceControlProvider(gitea),
    },
    connectionExternalUrl(connection: {externalAccountId: string}): Promise<string | undefined> {
      const base = config.GITEA_BASE_URL.replace(TRAILING_SLASHES_RE, '');
      return Promise.resolve(`${base}/${encodeURIComponent(connection.externalAccountId)}`);
    },
    routes: [
      createGiteaConnectionRoutes({
        gitea,
        getExistingGiteaConnection: options.getExistingGiteaConnection,
        connectGiteaConnection: options.connectGiteaConnection,
      }),
    ],
  };
}
