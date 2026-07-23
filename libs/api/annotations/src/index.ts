import type {ShipfoxModule} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';
import {createAnnotationsInterModulePresentation} from '#presentation/inter-module.js';
import {annotationsRoutes} from '#presentation/routes/index.js';

export const annotationsModule: ShipfoxModule = {
  name: 'annotations',
  database: {db, migrationsPath, databaseNamespace: 'annotations'},
  routes: annotationsRoutes,
  interModulePresentations: [createAnnotationsInterModulePresentation()],
};
