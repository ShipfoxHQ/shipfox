import {defineRoute, prefetchLoginMethods, type RouterContext} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {LoginPage} from '#pages/login-page.js';
import {validateRedirectSearch} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  // Starts the lookup alongside the auth and page requests instead of after them.
  beforeLoad: ({context}: {context: RouterContext}) => {
    prefetchLoginMethods(context.queryClient);
  },
  validateSearch: validateRedirectSearch,
  component: () => (
    <GuestGuard>
      <LoginPage />
    </GuestGuard>
  ),
});
