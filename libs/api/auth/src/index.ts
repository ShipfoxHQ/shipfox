import type {ShipfoxModule} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';
import {authE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {authRoutes} from '#presentation/routes/index.js';

export type {JobLeaseTokenClaims} from '@shipfox/api-auth-dto';
export type {User, UserStatus} from '#core/entities/user.js';
export {issueJobLeaseToken, verifyJobLeaseToken} from '#core/job-lease-token.js';
export {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';

export const authModule: ShipfoxModule = {
  name: 'auth',
  database: {db, migrationsPath},
  auth: [createJwtAuthMethod(), createLeaseTokenAuthMethod()],
  routes: [authRoutes],
  e2eRoutes: [authE2eRoutes],
};
