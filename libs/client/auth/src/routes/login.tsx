import {defineRoute} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {LoginPage} from '#pages/login-page.js';

export default defineRoute({
  component: () => (
    <GuestGuard>
      <LoginPage />
    </GuestGuard>
  ),
});
