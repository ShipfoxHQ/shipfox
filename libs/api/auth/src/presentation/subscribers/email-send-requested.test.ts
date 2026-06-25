import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {onEmailVerificationSendRequested, onPasswordResetSendRequested} from './index.js';

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

vi.mock('#config.js', () => ({
  mailer: testMailer.mailer,
}));

describe('auth email subscribers', () => {
  beforeEach(() => {
    testMailer.captured.length = 0;
    testMailer.send.mockReset();
    testMailer.send.mockImplementation((message) => {
      testMailer.captured.push(message);
      return Promise.resolve();
    });
  });

  test('sends a rendered email verification message', async () => {
    await onEmailVerificationSendRequested({
      email: 'verify@example.com',
      verifyLink: 'https://app.example.test/auth/verify-email?token=verify-token',
    });

    expect(testMailer.captured).toHaveLength(1);
    expect(testMailer.captured[0]).toMatchObject({
      to: 'verify@example.com',
      subject: 'Verify your email',
    });
    expect(testMailer.captured[0]?.text).toContain('/auth/verify-email?token=verify-token');
    expect(testMailer.captured[0]?.html).toContain('/auth/verify-email?token');
    expect(testMailer.captured[0]?.html).toContain('verify-token');
  });

  test('sends a rendered password reset message', async () => {
    await onPasswordResetSendRequested({
      email: 'reset@example.com',
      resetLink: 'https://app.example.test/auth/reset?token=reset-token',
      expiresInHours: 1,
    });

    expect(testMailer.captured).toHaveLength(1);
    expect(testMailer.captured[0]).toMatchObject({
      to: 'reset@example.com',
      subject: 'Reset your password',
    });
    expect(testMailer.captured[0]?.text).toContain('/auth/reset?token=reset-token');
    expect(testMailer.captured[0]?.html).toContain('/auth/reset?token');
    expect(testMailer.captured[0]?.html).toContain('reset-token');
  });

  test('rethrows mailer failures so the outbox dispatcher retries', async () => {
    const failure = new Error('smtp unavailable');
    testMailer.send.mockRejectedValueOnce(failure);

    const promise = onEmailVerificationSendRequested({
      email: 'verify-failure@example.com',
      verifyLink: 'https://app.example.test/auth/verify-email?token=verify-token',
    });

    await expect(promise).rejects.toBe(failure);
  });
});
