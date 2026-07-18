import {defineRoute} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {SignupPage} from '#pages/signup-page.js';

export default defineRoute({
  component: () => (
    <GuestGuard>
      <SignupPage />
    </GuestGuard>
  ),
});
