import {
  type InvitationPreview,
  pendingInvitation,
  usePreviewInvitation,
} from '@shipfox/client-invitations';
import {parseRedirectContext} from '#/components/redirect-context.js';

export function extractInvitationToken(redirect: unknown): string | undefined {
  return parseRedirectContext(redirect).invitationToken;
}

export function useInvitationContext(token: string | undefined) {
  return usePreviewInvitation(token);
}

export {type InvitationPreview, pendingInvitation};
