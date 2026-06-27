import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';
import {createProvisionerTokenAuthMethod, routes} from '#presentation/index.js';

export const provisionersModule: ShipfoxModule = {
  name: 'provisioners',
  database: {db, migrationsPath},
  auth: [createProvisionerTokenAuthMethod()],
  routes,
};
