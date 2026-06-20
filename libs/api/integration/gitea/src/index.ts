import {giteaProviderKind} from '@shipfox/api-integration-gitea-dto';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export {closeDb, db, migrationsPath};

export function createGiteaIntegrationProvider() {
  return {
    provider: giteaProviderKind,
    displayName: 'Gitea',
    adapters: {},
    routes: [],
  };
}
