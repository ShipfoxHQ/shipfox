import {PROJECT_DELETED, type ProjectsEventMap} from '@shipfox/api-projects-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';
import {createAnnotationsInterModulePresentation} from '#presentation/inter-module.js';
import {annotationsRoutes} from '#presentation/routes/index.js';
import {onProjectDeleted} from '#presentation/subscribers/on-project-deleted.js';

const subscriber = subscriberFactory<Pick<ProjectsEventMap, typeof PROJECT_DELETED>>();

export const annotationsModule: ShipfoxModule = {
  name: 'annotations',
  database: {db, migrationsPath, databaseNamespace: 'annotations'},
  routes: annotationsRoutes,
  interModulePresentations: [createAnnotationsInterModulePresentation()],
  subscribers: [subscriber(PROJECT_DELETED, onProjectDeleted)],
};
