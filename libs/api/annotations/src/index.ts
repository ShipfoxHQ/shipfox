import type {ShipfoxModule} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';

export const annotationsModule: ShipfoxModule = {
  name: 'annotations',
  database: {db, migrationsPath},
};
