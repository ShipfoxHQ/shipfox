import {mailer} from '@shipfox/node-mailer';
import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {challenges, sendLimits} from '#db/schema/index.js';
import {
  confirmEmailChallenge,
  consumeEmailChallengeProof,
  createEmailChallenge,
  getEmailChallengeContinuation,
  resendEmailChallenge,
} from './email-challenges.js';
import {EmailChallengeError} from './errors.js';

const codePattern = /\d{8}/u;

function sentCode(send: ReturnType<typeof vi.fn>): string {
  const message = send.mock.calls.at(-1)?.[0] as {text: string};
  return message.text.match(codePattern)?.[0] ?? '';
}

describe('email challenges', () => {
  test('sends the verification code in a branded message', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();

    await createEmailChallenge({
      email: 'branded@example.com',
      purpose: 'signup',
      continuation: 'branded-browser',
      idempotencyKey: 'branded-request',
      sourceIp: '127.0.0.2',
    });
    const verificationCode = sentCode(send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'branded@example.com',
        subject: 'Your Shipfox verification code',
        html: expect.stringContaining(verificationCode),
        text: expect.stringContaining("You're almost there"),
      }),
    );
  });

  test('reuses one active challenge for concurrent create retries and exposes only timing', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const params = {
      email: 'retry-safe@example.com',
      purpose: 'social-login',
      continuation: 'browser-a',
      idempotencyKey: 'request-a',
      sourceIp: '127.0.0.10',
    };

    const [first, second] = await Promise.all([
      createEmailChallenge(params),
      createEmailChallenge(params),
    ]);
    const continuation = await getEmailChallengeContinuation({
      purpose: params.purpose,
      continuation: params.continuation,
      idempotencyKey: params.idempotencyKey,
    });

    expect(first).toEqual(second);
    expect(continuation).toEqual({
      expiresAt: first.expiresAt,
      nextResendAvailableAt: first.nextResendAvailableAt,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db().select().from(challenges).where(eq(challenges.id, first.id))).toHaveLength(1);
    await expect(
      getEmailChallengeContinuation({...params, continuation: 'browser-b'}),
    ).rejects.toMatchObject({code: 'invalid'});
    await expect(
      getEmailChallengeContinuation({
        purpose: params.purpose,
        continuation: params.continuation,
        idempotencyKey: 'missing-request',
      }),
    ).rejects.toMatchObject({code: 'invalid'});
  });

  test('expires continuation timing without exposing a terminal challenge', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const params = {
      email: 'expired@example.com',
      purpose: 'social-login',
      continuation: 'expired-browser',
      idempotencyKey: 'expired-request',
      sourceIp: '127.0.0.12',
    };
    const challenge = await createEmailChallenge(params);
    await db()
      .update(challenges)
      .set({expiresAt: new Date(Date.now() - 1)})
      .where(eq(challenges.id, challenge.id));

    await expect(
      getEmailChallengeContinuation({
        purpose: params.purpose,
        continuation: params.continuation,
        idempotencyKey: params.idempotencyKey,
      }),
    ).rejects.toMatchObject({code: 'expired'});
    const replacement = await createEmailChallenge(params);

    expect(replacement.id).not.toBe(challenge.id);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('allows a fresh challenge after a terminal attempt for a stable caller key', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const params = {
      email: 'terminal@example.com',
      purpose: 'password-verification',
      continuation: 'user-123',
      idempotencyKey: 'user-123',
      sourceIp: '127.0.0.15',
    };
    const challenge = await createEmailChallenge(params);
    const validCode = sentCode(send);
    const invalidCode = validCode === '00000000' ? '00000001' : '00000000';
    await db()
      .update(challenges)
      .set({failedAttemptCount: 4})
      .where(eq(challenges.id, challenge.id));

    await expect(
      confirmEmailChallenge({
        id: challenge.id,
        code: invalidCode,
        continuation: params.continuation,
      }),
    ).rejects.toMatchObject({code: 'exhausted'});
    const replacement = await createEmailChallenge(params);

    expect(replacement.id).not.toBe(challenge.id);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('recovers the same challenge after delivery failure without retaining a competing code', async () => {
    const send = vi.spyOn(mailer, 'send').mockRejectedValueOnce(new Error('provider timeout'));
    const params = {
      email: 'delivery@example.com',
      purpose: 'social-login',
      continuation: 'delivery-browser',
      idempotencyKey: 'delivery-request',
      sourceIp: '127.0.0.11',
    };

    await expect(createEmailChallenge(params)).rejects.toThrow('provider timeout');
    const failed = await db().select().from(challenges).where(eq(challenges.email, params.email));
    expect(failed[0]?.deliveryState).toBe('failed');
    send.mockResolvedValue();

    const recovered = await createEmailChallenge(params);
    const recoveryCode = sentCode(send);
    await confirmEmailChallenge({
      id: recovered.id,
      code: recoveryCode,
      continuation: params.continuation,
    });

    await expect(
      getEmailChallengeContinuation({
        purpose: params.purpose,
        continuation: params.continuation,
        idempotencyKey: params.idempotencyKey,
      }),
    ).rejects.toMatchObject({code: 'invalid'});
    expect(
      await db().select().from(challenges).where(eq(challenges.id, recovered.id)),
    ).toHaveLength(1);
  });

  test('limits repeated delivery recovery attempts for one idempotency key', async () => {
    const send = vi.spyOn(mailer, 'send').mockRejectedValue(new Error('provider timeout'));
    const params = {
      email: 'limited-delivery@example.com',
      purpose: 'social-login',
      continuation: 'limited-delivery-browser',
      idempotencyKey: 'limited-delivery-request',
      sourceIp: '127.0.0.13',
    };

    await expect(createEmailChallenge(params)).rejects.toThrow('provider timeout');
    await expect(createEmailChallenge(params)).rejects.toThrow('provider timeout');
    await expect(createEmailChallenge(params)).rejects.toThrow('provider timeout');

    await expect(createEmailChallenge(params)).rejects.toMatchObject({code: 'exhausted'});
    expect(send).toHaveBeenCalledTimes(3);
  });

  test('records resend delivery failure so creation can recover the same challenge', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const params = {
      email: 'resend-delivery@example.com',
      purpose: 'social-login',
      continuation: 'resend-delivery-browser',
      idempotencyKey: 'resend-delivery-request',
      sourceIp: '127.0.0.14',
    };
    const challenge = await createEmailChallenge(params);
    await db()
      .update(challenges)
      .set({lastSentAt: new Date(Date.now() - 61_000)})
      .where(eq(challenges.id, challenge.id));
    send.mockRejectedValueOnce(new Error('provider timeout'));

    await expect(
      resendEmailChallenge({
        id: challenge.id,
        continuation: params.continuation,
        sourceIp: params.sourceIp,
      }),
    ).rejects.toThrow('provider timeout');
    const failed = await db().select().from(challenges).where(eq(challenges.id, challenge.id));
    expect(failed[0]?.deliveryState).toBe('failed');
    send.mockResolvedValue();

    await expect(createEmailChallenge(params)).resolves.toMatchObject({id: challenge.id});
  });

  test('replaces the code on resend and consumes only the same continuation idempotently', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const challenge = await createEmailChallenge({
      email: ' Person@Example.com ',
      purpose: 'signup',
      continuation: 'browser-a',
      idempotencyKey: 'person-request',
      sourceIp: '127.0.0.1',
    });
    const firstCode = sentCode(send);

    await new Promise((resolve) => setTimeout(resolve, 1));
    const resend = resendEmailChallenge({
      id: challenge.id,
      continuation: 'browser-a',
      sourceIp: '127.0.0.1',
    });
    await expect(resend).rejects.toMatchObject({code: 'cooldown'});

    await db()
      .update(challenges)
      .set({lastSentAt: new Date(Date.now() - 61_000)})
      .where(eq(challenges.id, challenge.id));
    await resendEmailChallenge({
      id: challenge.id,
      continuation: 'browser-a',
      sourceIp: '127.0.0.1',
    });
    const secondCode = sentCode(send);
    expect(secondCode).not.toBe(firstCode);
    await expect(
      confirmEmailChallenge({id: challenge.id, code: firstCode, continuation: 'browser-a'}),
    ).rejects.toMatchObject({code: 'invalid'});

    await confirmEmailChallenge({id: challenge.id, code: secondCode, continuation: 'browser-a'});
    expect(
      await consumeEmailChallengeProof({
        id: challenge.id,
        purpose: 'signup',
        continuation: 'browser-a',
      }),
    ).toEqual({consumed: true, idempotent: false});
    expect(
      await consumeEmailChallengeProof({
        id: challenge.id,
        purpose: 'signup',
        continuation: 'browser-a',
      }),
    ).toEqual({consumed: true, idempotent: true});
    await expect(
      consumeEmailChallengeProof({id: challenge.id, purpose: 'signup', continuation: 'browser-b'}),
    ).rejects.toMatchObject({code: 'consumed'});
  });

  test('does not persist plaintext destinations in send limits and rejects the sixth destination send', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    for (let index = 0; index < 5; index += 1)
      await createEmailChallenge({
        email: 'limit@example.com',
        purpose: `test-${index}`,
        continuation: `continuation-${index}`,
        idempotencyKey: `request-${index}`,
        sourceIp: `10.0.0.${index}`,
      });

    await expect(
      createEmailChallenge({
        email: 'limit@example.com',
        purpose: 'blocked',
        continuation: 'continuation-blocked',
        idempotencyKey: 'blocked-request',
        sourceIp: '10.0.0.99',
      }),
    ).rejects.toBeInstanceOf(EmailChallengeError);
    expect(send).toHaveBeenCalledTimes(5);
    const limits = await db().select().from(sendLimits);
    expect(JSON.stringify(limits)).not.toContain('limit@example.com');
  });

  test('persists failed attempts and makes a confirmed retry idempotent', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const challenge = await createEmailChallenge({
      email: 'attempts@example.com',
      purpose: 'signup',
      continuation: 'browser-a',
      idempotencyKey: 'attempts-request',
      sourceIp: '10.0.1.1',
    });
    const validCode = sentCode(send);
    const invalidCode = validCode === '00000000' ? '00000001' : '00000000';

    for (let attempt = 0; attempt < 4; attempt += 1)
      await expect(
        confirmEmailChallenge({id: challenge.id, code: invalidCode, continuation: 'browser-a'}),
      ).rejects.toMatchObject({code: 'invalid'});
    await expect(
      confirmEmailChallenge({id: challenge.id, code: invalidCode, continuation: 'browser-a'}),
    ).rejects.toMatchObject({code: 'exhausted'});
    await expect(
      confirmEmailChallenge({id: challenge.id, code: validCode, continuation: 'browser-a'}),
    ).rejects.toMatchObject({code: 'invalid'});

    const retryChallenge = await createEmailChallenge({
      email: 'retry@example.com',
      purpose: 'signup',
      continuation: 'browser-a',
      idempotencyKey: 'retry-request',
      sourceIp: '10.0.1.2',
    });
    const retryCode = sentCode(send);
    await confirmEmailChallenge({
      id: retryChallenge.id,
      code: retryCode,
      continuation: 'browser-a',
    });

    await expect(
      confirmEmailChallenge({id: retryChallenge.id, code: retryCode, continuation: 'browser-a'}),
    ).resolves.toEqual({confirmed: true});
  });
});
