import {defineRoute} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {PasswordLoginGate} from '#components/password-login-gate.js';
import {PasswordResetPage} from '#pages/password-reset-page.js';
import {validatePasswordResetSearch} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: validatePasswordResetSearch,
  component: () => (
    <GuestGuard>
      <PasswordLoginGate>
        <PasswordResetPage />
      </PasswordLoginGate>
    </GuestGuard>
  ),
});
