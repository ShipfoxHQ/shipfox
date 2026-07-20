import {mailer} from '@shipfox/node-mailer';
import {vi} from '@shipfox/vitest/vi';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {challenges, sendLimits} from '#db/schema/index.js';
import {
  confirmEmailChallenge,
  consumeEmailChallengeProof,
  createEmailChallenge,
  resendEmailChallenge,
} from './email-challenges.js';
import {EmailChallengeError} from './errors.js';

const codePattern = /\d{8}/u;

function sentCode(send: ReturnType<typeof vi.fn>): string {
  const message = send.mock.calls.at(-1)?.[0] as {text: string};
  return message.text.match(codePattern)?.[0] ?? '';
}

describe('email challenges', () => {
  test('replaces the code on resend and consumes only the same continuation idempotently', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const challenge = await createEmailChallenge({
      email: ' Person@Example.com ',
      purpose: 'signup',
      continuation: 'browser-a',
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
        sourceIp: `10.0.0.${index}`,
      });

    await expect(
      createEmailChallenge({
        email: 'limit@example.com',
        purpose: 'blocked',
        continuation: 'continuation-blocked',
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
