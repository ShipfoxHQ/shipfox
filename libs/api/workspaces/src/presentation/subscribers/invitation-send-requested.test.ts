import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {onInvitationSendRequested} from './index.js';

const testMailer = vi.hoisted(
  (): {
    captured: MailMessage[];
    send: ReturnType<typeof vi.fn<Mailer['send']>>;
    mailer: Mailer;
  } => {
    const captured: MailMessage[] = [];
    const send = vi.fn<Mailer['send']>((message) => {
      captured.push(message);
      return Promise.resolve();
    });
    return {captured, send, mailer: {send}};
  },
);

vi.mock('@shipfox/node-mailer', () => ({
  mailer: testMailer.mailer,
}));

describe('workspace invitation email subscriber', () => {
  beforeEach(() => {
    testMailer.captured.length = 0;
    testMailer.send.mockReset();
    testMailer.send.mockImplementation((message) => {
      testMailer.captured.push(message);
      return Promise.resolve();
    });
  });

  test('sends a rendered workspace invitation message', async () => {
    await onInvitationSendRequested({
      email: 'invitee@example.com',
      workspaceName: 'Acme Ops',
      inviterName: 'Dana Scully',
      inviteLink: 'https://app.example.test/invitations/accept?token=invite-token',
    });

    expect(testMailer.captured).toHaveLength(1);
    expect(testMailer.captured[0]).toMatchObject({
      to: 'invitee@example.com',
      subject: 'Join Acme Ops on Shipfox',
    });
    expect(testMailer.captured[0]?.text).toContain('Dana Scully has invited you');
    expect(testMailer.captured[0]?.text).toContain('/invitations/accept?token=invite-token');
    expect(testMailer.captured[0]?.html).toContain('Dana Scully');
  });

  test('rethrows mailer failures so the outbox dispatcher retries', async () => {
    const failure = new Error('smtp unavailable');
    testMailer.send.mockRejectedValueOnce(failure);

    const promise = onInvitationSendRequested({
      email: 'invite-failure@example.com',
      workspaceName: 'Acme Ops',
      inviterName: 'Dana Scully',
      inviteLink: 'https://app.example.test/invitations/accept?token=invite-token',
    });

    await expect(promise).rejects.toBe(failure);
  });
});
