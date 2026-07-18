import {defineRoute} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {VerifyEmailPage} from '#pages/verify-email-page.js';

export default defineRoute({
  component: () => (
    <GuestGuard>
      <VerifyEmailPage />
    </GuestGuard>
  ),
});
