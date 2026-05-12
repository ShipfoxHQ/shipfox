import {InvitationAcceptPage} from '@shipfox/client-invitations';
import {createFileRoute} from '@tanstack/react-router';

// Pre-auth: NOT wrapped in AuthGuard/GuestGuard. The page itself branches on
// auth state (existing user, mismatched account, new user) per the state matrix.
export const Route = createFileRoute('/invitations/accept')({
  component: InvitationAcceptPage,
});
