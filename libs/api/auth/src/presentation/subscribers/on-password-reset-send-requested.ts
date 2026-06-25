import type {AuthPasswordResetSendRequestedEvent} from '@shipfox/api-auth-dto';
import {renderEmail} from '@shipfox/node-email';
import {mailer} from '#config.js';

export async function onPasswordResetSendRequested(
  payload: AuthPasswordResetSendRequestedEvent,
): Promise<void> {
  const email = await renderEmail('reset-password', {
    resetLink: payload.resetLink,
    expiresInHours: payload.expiresInHours,
  });
  await mailer.send({to: payload.email, ...email});
}
