import {defineRoute, prefetchLoginMethods, type RouterContext} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {PasswordLoginGate} from '#components/password-login-gate.js';
import {PasswordResetPage} from '#pages/password-reset-page.js';
import {validatePasswordResetSearch} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  // Starts the lookup alongside the auth and page requests instead of after them.
  beforeLoad: ({context}: {context: RouterContext}) => {
    prefetchLoginMethods(context.queryClient);
  },
  validateSearch: validatePasswordResetSearch,
  component: () => (
    <GuestGuard>
      <PasswordLoginGate>
        <PasswordResetPage />
      </PasswordLoginGate>
    </GuestGuard>
  ),
});
