import {
  AUTH_EMAIL_VERIFICATION_SEND_REQUESTED,
  AUTH_PASSWORD_RESET_SEND_REQUESTED,
  authEventSchemas,
} from '@shipfox/api-auth-dto';
import {authModule} from './index.js';

vi.mock('#config.js', () => ({
  config: {
    AUTH_JWT_SECRET: 'auth-module-test-secret',
    AUTH_JWT_EXPIRES_IN: '15m',
    AUTH_JOB_LEASE_TOKEN_SECRET: 'auth-module-test-job-secret',
    AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: '90m',
    AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: 14,
    AUTH_REFRESH_ROTATION_GRACE_SECONDS: 30,
    AUTH_REFRESH_COOKIE_NAME: 'shipfox_refresh_token',
    CLIENT_BASE_URL: 'https://app.example.test',
  },
  mailer: {send: vi.fn()},
}));

describe('authModule', () => {
  test('registers auth email outbox publisher and subscribers', () => {
    const publisher = authModule.publishers?.find((pub) => pub.name === 'auth');
    const events = authModule.subscribers?.map((subscriber) => subscriber.event);

    expect(publisher?.eventSchemas).toBe(authEventSchemas);
    expect(Object.keys(publisher?.eventSchemas ?? {}).sort()).toEqual([
      AUTH_EMAIL_VERIFICATION_SEND_REQUESTED,
      AUTH_PASSWORD_RESET_SEND_REQUESTED,
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        AUTH_EMAIL_VERIFICATION_SEND_REQUESTED,
        AUTH_PASSWORD_RESET_SEND_REQUESTED,
      ]),
    );
  });
});
