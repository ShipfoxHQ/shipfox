import {giteaProviderKind} from '@shipfox/api-integration-gitea-dto';
import {createGiteaApiClient, type GiteaApiClient} from '#api/client.js';
import {GiteaSourceControlProvider} from '#core/source-control.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export type {
  GiteaApiClient,
  GiteaFileContent,
  GiteaRepository,
  GiteaRepositoryPage,
  GiteaTree,
  GiteaTreeBlob,
} from '#api/client.js';
export {createGiteaApiClient} from '#api/client.js';
export {GiteaIntegrationProviderError} from '#core/errors.js';
export {GiteaSourceControlProvider} from '#core/source-control.js';
export {closeDb, db, migrationsPath};

export interface CreateGiteaIntegrationProviderOptions {
  gitea?: GiteaApiClient | undefined;
}

export function createGiteaIntegrationProvider(
  options: CreateGiteaIntegrationProviderOptions = {},
) {
  const gitea = options.gitea ?? createGiteaApiClient();

  return {
    provider: giteaProviderKind,
    displayName: 'Gitea',
    adapters: {
      source_control: new GiteaSourceControlProvider(gitea),
    },
    routes: [],
  };
}
