import {
  AUTH_EMAIL_VERIFICATION_SEND_REQUESTED,
  AUTH_PASSWORD_RESET_SEND_REQUESTED,
  type AuthEventMap,
  authEventSchemas,
} from '@shipfox/api-auth-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {subscriberFactory} from '@shipfox/node-module';
import {config} from '#config.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {authOutbox} from '#db/schema/outbox.js';
import {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
import {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';
import {createRunnerSessionAuthMethod} from '#presentation/auth/runner-session-auth.js';
import {authE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createAuthInterModulePresentation} from '#presentation/inter-module.js';
import {authRoutes} from '#presentation/routes/index.js';
import {
  onEmailVerificationSendRequested,
  onPasswordResetSendRequested,
} from '#presentation/subscribers/index.js';
import {passwordLoginMethods} from './login-methods.js';

export type {JobLeaseTokenClaims, RunnerSessionTokenClaims} from '@shipfox/api-auth-dto';
export type {
  CreateSessionForUserError,
  CreateSessionForUserParams,
  CreateSessionForUserResult,
  ProvisionUserParams,
} from '#core/auth.js';
export {createSessionForUser, provisionUser} from '#core/auth.js';
export type {EmailOwner, FindUserByEmailParams} from '#core/email-owner.js';
export {findUserByEmail} from '#core/email-owner.js';
export type {User, UserStatus} from '#core/entities/user.js';
export {
  AuthDependencyUnavailableError,
  EmailNotVerifiedError,
  InvalidCredentialsError,
  UserNotFoundError,
} from '#core/errors.js';
export {
  issueJobLeaseToken,
  jobLeaseParamsFrom,
  verifyJobLeaseToken,
} from '#core/job-lease-token.js';
export {
  issueRunnerSessionToken,
  verifyRunnerSessionToken,
} from '#core/runner-session-token.js';
export {createJwtAuthMethod} from '#presentation/auth/jwt-auth.js';
export {createLeaseTokenAuthMethod} from '#presentation/auth/lease-token-auth.js';
export {
  authCookiePlugin,
  clearRefreshTokenCookie,
  getRefreshTokenCookie,
  setRefreshTokenCookie,
} from '#presentation/auth/refresh-cookie.js';
export {createRunnerSessionAuthMethod} from '#presentation/auth/runner-session-auth.js';

const subscriber = subscriberFactory<AuthEventMap>();

export const authModule: ShipfoxModule = {
  name: 'auth',
  database: {db, migrationsPath},
  auth: [createJwtAuthMethod(), createLeaseTokenAuthMethod(), createRunnerSessionAuthMethod()],
  loginMethods: passwordLoginMethods(config.AUTH_PASSWORD_ENABLED),
  routes: [authRoutes],
  e2eRoutes: [authE2eRoutes],
  publishers: [{name: 'auth', table: authOutbox, db, eventSchemas: authEventSchemas}],
  subscribers: [
    subscriber(AUTH_EMAIL_VERIFICATION_SEND_REQUESTED, onEmailVerificationSendRequested),
    subscriber(AUTH_PASSWORD_RESET_SEND_REQUESTED, onPasswordResetSendRequested),
  ],
  interModulePresentations: [createAuthInterModulePresentation()],
};
