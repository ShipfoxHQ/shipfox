import type {AppConfig, FastifyInstance} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import {
  type AuthRateLimitAction,
  type AuthRateLimitScope,
  checkAuthRateLimit,
  hashAuthRateLimitIdentifier,
} from '#core/rate-limit.js';
import {db} from '#db/db.js';
import {countAuthRateLimitsForIdentifierHmac} from '#db/rate-limits.js';
import {authRateLimits} from '#db/schema/rate-limits.js';
import {
  capturedMail,
  createAuthTestApp,
  resetCapturedMail,
  signupVerifyLogin,
  uniqueEmail,
} from '#test/routes.js';

let ipCounter = 1;

function uniqueIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

async function exhaustBucket(params: {
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  await Promise.all(
    Array.from({length: params.limit}, () =>
      checkAuthRateLimit({
        action: params.action,
        scope: params.scope,
        identifier: params.identifier,
        limit: params.limit,
        windowSeconds: params.windowSeconds,
      }),
    ),
  );
}

async function countBucket(params: {
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  identifier: string;
}): Promise<number> {
  const identifierHmac = hashAuthRateLimitIdentifier({
    action: params.action,
    scope: params.scope,
    identifier: params.identifier,
  });

  return await countAuthRateLimitsForIdentifierHmac({identifierHmac});
}

function windowStartFor(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

type LoggerInstance = NonNullable<NonNullable<AppConfig['fastifyOptions']>['loggerInstance']>;

function createCapturingLogger(logs: unknown[]): LoggerInstance {
  const logger = {
    child: () => logger,
    level: 'info',
    silent: (...args: unknown[]) => {
      logs.push(['silent', ...args]);
    },
    fatal: (...args: unknown[]) => {
      logs.push(['fatal', ...args]);
    },
    error: (...args: unknown[]) => {
      logs.push(['error', ...args]);
    },
    warn: (...args: unknown[]) => {
      logs.push(['warn', ...args]);
    },
    info: (...args: unknown[]) => {
      logs.push(['info', ...args]);
    },
    debug: (...args: unknown[]) => {
      logs.push(['debug', ...args]);
    },
    trace: (...args: unknown[]) => {
      logs.push(['trace', ...args]);
    },
  };
  return logger as unknown as LoggerInstance;
}

describe('auth rate-limit routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetCapturedMail();
    app = await createAuthTestApp({fastifyOptions: {trustProxy: true}});
  });

  afterEach(async () => {
    await app.close();
  });

  it('blocks exhausted login IP buckets before login work runs', async () => {
    const ip = uniqueIp();
    await exhaustBucket({
      action: 'login',
      scope: 'ip',
      identifier: ip,
      limit: 60,
      windowSeconds: 5 * 60,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: {'x-forwarded-for': ip},
      payload: {email: uniqueEmail('login-ip-block'), password: 'wrong password'},
    });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      code: 'rate-limited',
      details: {retry_after_seconds: expect.any(Number)},
    });
    expect(res.headers['retry-after']).toEqual(expect.any(String));
  });

  it('blocks exhausted login email buckets after the IP bucket passes', async () => {
    const ip = uniqueIp();
    const email = uniqueEmail('login-email-block');
    await exhaustBucket({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 10,
      windowSeconds: 15 * 60,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: {'x-forwarded-for': ip},
      payload: {email, password: 'wrong password'},
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate-limited');
    expect(await countBucket({action: 'login', scope: 'ip', identifier: ip})).toBe(1);
  });

  it('shares the email-send bucket across password reset and verification resend', async () => {
    const account = await signupVerifyLogin(app, 'email-send-shared');
    resetCapturedMail();

    for (let index = 0; index < 3; index += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/password-reset',
        headers: {'x-forwarded-for': uniqueIp()},
        payload: {email: account.email},
      });
      expect(res.statusCode).toBe(204);
    }
    const blockedReset = await app.inject({
      method: 'POST',
      url: '/auth/password-reset',
      headers: {'x-forwarded-for': uniqueIp()},
      payload: {email: account.email},
    });
    const blockedResend = await app.inject({
      method: 'POST',
      url: '/auth/verify-email/resend',
      headers: {'x-forwarded-for': uniqueIp()},
      payload: {email: account.email},
    });

    expect(blockedReset.statusCode).toBe(429);
    expect(blockedResend.statusCode).toBe(429);
    expect(
      capturedMail().filter((message) => message.subject === 'Reset your password'),
    ).toHaveLength(3);
  });

  it('does not consume buckets for invalid bodies', async () => {
    const ip = uniqueIp();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: {'x-forwarded-for': ip},
      payload: {email: 'not-an-email', password: 'wrong password'},
    });

    expect(res.statusCode).toBe(400);
    expect(await countBucket({action: 'login', scope: 'ip', identifier: ip})).toBe(0);
  });

  it('fails closed when limiter storage is unavailable', async () => {
    const ip = uniqueIp();
    const identifierHmac = hashAuthRateLimitIdentifier({
      action: 'login',
      scope: 'ip',
      identifier: ip,
    });
    const windowStart = windowStartFor(new Date(), 5 * 60);
    await db()
      .insert(authRateLimits)
      .values({
        action: 'login',
        scope: 'ip',
        identifierHmac,
        windowStart,
        count: 1,
        expiresAt: new Date(windowStart.getTime() + 5 * 60 * 1000),
      });

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM auth_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: {'x-forwarded-for': ip},
        payload: {email: uniqueEmail('limiter-unavailable'), password: 'wrong password'},
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({code: 'auth-rate-limit-unavailable'});
    });
  });

  it('does not log raw email addresses or IP addresses for blocked requests', async () => {
    await app.close();
    const logs: unknown[] = [];
    app = await createAuthTestApp({
      fastifyOptions: {loggerInstance: createCapturingLogger(logs), trustProxy: true},
    });
    const ip = uniqueIp();
    const email = uniqueEmail('log-privacy');
    await exhaustBucket({
      action: 'login',
      scope: 'email',
      identifier: email,
      limit: 10,
      windowSeconds: 15 * 60,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: {'x-forwarded-for': ip},
      payload: {email, password: 'wrong password'},
    });
    const authLogs = logs.filter((entry) => {
      const serializedEntry = JSON.stringify(entry);
      return (
        serializedEntry.includes('Auth rate limit blocked request') ||
        serializedEntry.includes('Rate limit exceeded')
      );
    });
    const serializedLogs = JSON.stringify(authLogs);

    expect(res.statusCode).toBe(429);
    expect(serializedLogs).toContain('identifierHmacPrefix');
    expect(serializedLogs).not.toContain(email);
    expect(serializedLogs).not.toContain(ip);
  });
});
