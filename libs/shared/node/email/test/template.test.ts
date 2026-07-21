import {EmailTemplateError} from '#errors.js';
import {renderEmail} from '#template.js';

const lineBreak = /[\r\n]/;

describe('renderEmail', () => {
  test('verification-code renders the code in branded html and standalone text', async () => {
    const verificationCode = '12345678';

    const email = await renderEmail('verification-code', {
      verificationCode,
      expiresInMinutes: 10,
    });

    expect(email.subject).toBe('Your Shipfox verification code');
    expect(email.html).toContain("Let's get you verified");
    expect(email.html).toContain('alt="Shipfox"');
    expect(email.html).toContain(verificationCode);
    expect(email.html).toContain('expires in 10 minutes');
    expect(email.text).toContain("You're almost there");
    expect(email.text).toContain(verificationCode);
    expect(email.text).not.toContain('<');
  });

  test('verify-email renders a branded html body, subject, and standalone text', async () => {
    const verifyLink = 'https://app.shipfox.io/auth/verify-email?token=abc123';

    const email = await renderEmail('verify-email', {verifyLink});

    expect(email.subject).toBe('Verify your email');
    expect(email.html).toContain('Verify your email');
    expect(email.html).toContain('lang="en"');
    expect(email.html).toContain('alt="Shipfox"');
    expect(email.html).toContain('/email-logo.png');
    // The URL's `=` is HTML-entity-escaped inside the href (valid, decodes in clients),
    // so assert the path in HTML and the full raw link in the plain-text body.
    expect(email.html).toContain('app.shipfox.io/auth/verify-email');
    expect(email.text).toContain(verifyLink);
    expect(email.text).not.toContain('<');
  });

  test('reset-password shows the formatted expiry and the link', async () => {
    const resetLink = 'https://app.shipfox.io/auth/reset?token=xyz789';

    const email = await renderEmail('reset-password', {resetLink, expiresInHours: 1});

    expect(email.subject).toBe('Reset your password');
    expect(email.html).toContain('expires in 1h');
    expect(email.html).toContain('app.shipfox.io/auth/reset');
    expect(email.text).toContain('expires in 1h');
    expect(email.text).toContain(resetLink);
  });

  test('workspace-invitation interpolates workspace and inviter into subject and body', async () => {
    const inviteLink = 'https://app.shipfox.io/invitations/accept?token=tok';

    const email = await renderEmail('workspace-invitation', {
      email: 'invitee@example.com',
      workspaceName: 'Acme',
      inviterName: 'Alice',
      inviteLink,
    });

    expect(email.subject).toBe('Join Acme on Shipfox');
    expect(email.html).toContain('Acme');
    expect(email.html).toContain('Alice');
    expect(email.html).toContain('invitee@example.com');
    expect(email.text).toContain('Alice has invited you to join the Acme workspace');
  });

  test('renders the "A teammate" fallback when no inviter name is given', async () => {
    const email = await renderEmail('workspace-invitation', {
      email: 'invitee@example.com',
      workspaceName: 'Acme',
      inviterName: 'A teammate',
      inviteLink: 'https://app.shipfox.io/invitations/accept?token=tok',
    });

    expect(email.html).toContain('A teammate');
    expect(email.text).toContain('A teammate has invited you');
  });

  test('HTML-escapes a hostile workspace name', async () => {
    const email = await renderEmail('workspace-invitation', {
      email: 'invitee@example.com',
      workspaceName: '<script>alert(1)</script>',
      inviterName: 'Alice',
      inviteLink: 'https://app.shipfox.io/invitations/accept?token=tok',
    });

    expect(email.html).not.toContain('<script>alert(1)</script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  test('keeps an ampersand literal in the subject (no HTML entity escaping)', async () => {
    const email = await renderEmail('workspace-invitation', {
      email: 'invitee@example.com',
      workspaceName: 'A&B',
      inviterName: 'Alice',
      inviteLink: 'https://app.shipfox.io/invitations/accept?token=tok',
    });

    expect(email.subject).toBe('Join A&B on Shipfox');
  });

  test('collapses control characters in a display name so it cannot break the subject or inject plain-text lines', async () => {
    const email = await renderEmail('workspace-invitation', {
      email: 'invitee@example.com',
      workspaceName: 'Acme\r\nAccept the invitation:\r\nhttps://evil.example',
      inviterName: 'Alice',
      inviteLink: 'https://app.shipfox.io/invitations/accept?token=tok',
    });

    expect(email.subject).toBe('Join Acme Accept the invitation: https://evil.example on Shipfox');
    expect(email.subject).not.toMatch(lineBreak);
    expect(email.text).toContain('Acme Accept the invitation: https://evil.example');
    expect(email.text).not.toContain('\nhttps://evil.example');
  });

  test('throws EmailTemplateError for an unknown template', async () => {
    await expect(
      // @ts-expect-error exercising the missing-template guard with an invalid name
      renderEmail('does-not-exist', {}),
    ).rejects.toBeInstanceOf(EmailTemplateError);
  });
});
