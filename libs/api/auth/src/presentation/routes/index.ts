import type {RouteGroup} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {authCookiePlugin} from '#presentation/auth/refresh-cookie.js';
import {verifyEmailConfirmRoute} from './email-verification/verify-email-confirm.js';
import {verifyEmailResendRoute} from './email-verification/verify-email-resend.js';
import {changePasswordRoute} from './password/change-password.js';
import {passwordResetConfirmRoute} from './password/password-reset-confirm.js';
import {passwordResetRequestRoute} from './password/password-reset-request.js';
import {signupRoute} from './registration/signup.js';
import {loginRoute} from './session/login.js';
import {logoutRoute} from './session/logout.js';
import {meRoute} from './session/me.js';
import {refreshRoute} from './session/refresh.js';

export function buildAuthRoutes(passwordEnabled: boolean): RouteGroup {
  const passwordRoutes = passwordEnabled
    ? [signupRoute, verifyEmailConfirmRoute, verifyEmailResendRoute, loginRoute]
    : [];

  return {
    prefix: '/auth',
    plugins: [authCookiePlugin],
    routes: [
      ...passwordRoutes,
      refreshRoute,
      logoutRoute,
      meRoute,
      ...(passwordEnabled
        ? [changePasswordRoute, passwordResetRequestRoute, passwordResetConfirmRoute]
        : []),
    ],
  };
}

export const authRoutes = buildAuthRoutes(config.AUTH_PASSWORD_ENABLED);
