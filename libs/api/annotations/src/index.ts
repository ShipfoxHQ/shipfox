import type {ShipfoxModule} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';
import {annotationsRoutes} from '#presentation/routes/index.js';

export {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from '#core/errors.js';
export {type WriteAnnotationsParams, writeAnnotations} from '#core/write-annotations.js';

export const annotationsModule: ShipfoxModule = {
  name: 'annotations',
  database: {db, migrationsPath},
  routes: annotationsRoutes,
};
