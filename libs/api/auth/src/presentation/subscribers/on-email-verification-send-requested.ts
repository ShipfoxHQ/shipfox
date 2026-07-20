import type {AuthEmailVerificationSendRequestedEvent} from '@shipfox/api-auth-dto';
import {renderEmail} from '@shipfox/node-email';
import {mailer} from '@shipfox/node-mailer';

export async function onEmailVerificationSendRequested(
  payload: AuthEmailVerificationSendRequestedEvent,
): Promise<void> {
  const email = await renderEmail('verify-email', {verifyLink: payload.verifyLink});
  await mailer.send({to: payload.email, ...email});
}
