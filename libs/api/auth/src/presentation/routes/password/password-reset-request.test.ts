import {AUTH_PASSWORD_RESET_SEND_REQUESTED} from '@shipfox/api-auth-dto';
import type {FastifyInstance} from 'fastify';
import {
  capturedMail,
  createAuthTestApp,
  latestEmailLinkTo,
  outboxEventsTo,
  resetCapturedMail,
  signupVerifyLogin,
  uniqueEmail,
} from '#test/routes.js';

describe('POST /auth/password-reset', () => {
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

  test('returns 204 and sends reset mail for an active account', async () => {
    const account = await signupVerifyLogin(app, 'reset-request');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: {email: account.email.toUpperCase()},
    });

    expect(res.statusCode).toBe(204);
    expect(await latestEmailLinkTo(account.email, AUTH_PASSWORD_RESET_SEND_REQUESTED)).toContain(
      '/auth/reset?token=',
    );
    expect(capturedMail()).toHaveLength(0);
  });

  test('returns 204 without revealing missing accounts', async () => {
    const email = uniqueEmail('missing-reset');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      payload: {email},
    });

    expect(res.statusCode).toBe(204);
    expect(await outboxEventsTo(email, AUTH_PASSWORD_RESET_SEND_REQUESTED)).toHaveLength(0);
  });
});
