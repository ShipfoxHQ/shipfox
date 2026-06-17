import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath} from '#db/index.js';
import {logIngestRoutes} from '#presentation/routes/index.js';

export {checkBucketReachable} from '#api/object-storage.js';

// Publisher registration is deferred to ENG-442 (the first event, stream-closed,
// is owned there); the outbox table ships now so that PR alters no shipped schema.
export const logIngestModule: ShipfoxModule = {
  name: 'log-ingest',
  database: {db, migrationsPath},
  routes: logIngestRoutes,
};
