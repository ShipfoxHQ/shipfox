import {
  AUTH_EMAIL_VERIFICATION_SEND_REQUESTED,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from '@shipfox/api-auth-dto';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {emailVerifications} from '#db/schema/email-verifications.js';
import {
  createAuthTestApp,
  outboxEventsTo,
  resetCapturedMail,
  signup,
  uniqueEmail,
  verifyEmail,
} from '#test/routes.js';

describe('POST /auth/verify-email/resend', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createAuthTestApp();
  });

  beforeEach(() => {
    resetCapturedMail();
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns 200 without sending during cooldown for an unverified account', async () => {
    const email = uniqueEmail('verify-resend');
    await signup(app, {email, password: 'correct horse battery staple'});

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: {email: email.toUpperCase()},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().next_resend_available_at).toEqual(expect.any(String));
    expect(await outboxEventsTo(email, AUTH_EMAIL_VERIFICATION_SEND_REQUESTED)).toHaveLength(1);
  });

  test('returns 200 and sends a new token after cooldown', async () => {
    const email = uniqueEmail('verify-resend-ready');
    const signupRes = await signup(app, {email, password: 'correct horse battery staple'});
    const staleCreatedAt = new Date(
      Date.now() - (EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS + 1) * 1000,
    );
    await db()
      .update(emailVerifications)
      .set({createdAt: staleCreatedAt})
      .where(eq(emailVerifications.userId, signupRes.json().user.id));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: {email},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().next_resend_available_at).toEqual(expect.any(String));
    expect(await outboxEventsTo(email, AUTH_EMAIL_VERIFICATION_SEND_REQUESTED)).toHaveLength(2);
  });

  test('returns 200 without sending mail for a verified account', async () => {
    const email = uniqueEmail('verify-resend-verified');
    await signup(app, {email, password: 'correct horse battery staple'});
    await verifyEmail(app, email);
    resetCapturedMail();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: {email},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().next_resend_available_at).toEqual(expect.any(String));
    expect(await outboxEventsTo(email, AUTH_EMAIL_VERIFICATION_SEND_REQUESTED)).toHaveLength(1);
  });

  test('returns the same response shape for a missing account', async () => {
    const email = uniqueEmail('verify-resend-missing');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      payload: {email},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({next_resend_available_at: expect.any(String)});
    expect(await outboxEventsTo(email, AUTH_EMAIL_VERIFICATION_SEND_REQUESTED)).toHaveLength(0);
  });
});
