import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';
import {createCacheRoutes} from '#presentation/routes/index.js';

export {checkBucketReachable} from '#api/object-storage.js';

export function createCacheModule({workflows}: {workflows: WorkflowsModuleClient}): ShipfoxModule {
  return {
    name: 'cache',
    database: {db, migrationsPath, databaseNamespace: 'cache'},
    routes: createCacheRoutes(workflows),
  };
}
