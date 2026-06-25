import type {WorkspacesInvitationSendRequestedEvent} from '@shipfox/api-workspaces-dto';
import {renderEmail} from '@shipfox/node-email';
import {mailer} from '#config.js';

export async function onInvitationSendRequested(
  payload: WorkspacesInvitationSendRequestedEvent,
): Promise<void> {
  const email = await renderEmail('workspace-invitation', {
    email: payload.email,
    workspaceName: payload.workspaceName,
    inviterName: payload.inviterName,
    inviteLink: payload.inviteLink,
  });
  await mailer.send({to: payload.email, ...email});
}
