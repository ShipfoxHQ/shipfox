import {
  defineRoute,
  loginMethodsQueryOptions,
  type RouterContext,
} from '@shipfox/client-shell/runtime';
import {InvitationAcceptPage} from '#pages/invitation-accept-page.js';
import {validateInvitationAcceptSearch} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  // Starts the lookup alongside the auth and page requests instead of after them.
  beforeLoad: ({context}: {context: RouterContext}) => {
    void context.queryClient?.prefetchQuery(loginMethodsQueryOptions());
  },
  validateSearch: validateInvitationAcceptSearch,
  component: InvitationAcceptPage,
});
