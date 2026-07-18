import {defineRoute} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {PasswordResetPage} from '#pages/password-reset-page.js';

export default defineRoute({
  component: () => (
    <GuestGuard>
      <PasswordResetPage />
    </GuestGuard>
  ),
});
