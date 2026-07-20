import {createLeaseTokenAuthMethod, createRunnerSessionAuthMethod} from '@shipfox/api-auth';
import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
  setProvisionerContext,
} from '@shipfox/api-auth-context';
import {
  type AuthMethod,
  ClientError,
  closeApp,
  createApp,
  extractBearerToken,
} from '@shipfox/node-fastify';
import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {and, count, eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {config} from '#config.js';
import {hashRunnersRateLimitIdentifier} from '#core/rate-limit.js';
import {db} from '#db/db.js';
import {resolveEphemeralRegistrationTokenByHash} from '#db/ephemeral-registration-tokens.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {runnersRateLimits} from '#db/schema/rate-limits.js';
import {reservations} from '#db/schema/reservations.js';
import {createRunnerRegistrationTokenAuthMethod} from '#presentation/auth/index.js';
import {ephemeralRegistrationTokenFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

const VALID_PROVISIONER_TOKEN = 'valid-provisioner-token';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

const passthroughAuth = (name: string): AuthMethod => ({
  name,
  authenticate: () => Promise.resolve(),
});

describe('POST /provisioners/runner-registration-tokens/batch', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let provisionerTokenId: string;

  const fakeProvisionerAuth: AuthMethod = {
    name: AUTH_PROVISIONER_TOKEN,
    authenticate: (request: FastifyRequest) => {
      const rawToken = extractBearerToken(request.headers.authorization);
      if (rawToken !== VALID_PROVISIONER_TOKEN) {
        throw new ClientError('Invalid provisioner token', 'unauthorized', {status: 401});
      }
      setProvisionerContext(request, {scope: 'workspace', workspaceId, provisionerTokenId});
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeUserAuth,
        createRunnerRegistrationTokenAuthMethod(),
        createRunnerSessionAuthMethod(),
        createLeaseTokenAuthMethod(),
        passthroughAuth(AUTH_RUNNER_SESSION),
        passthroughAuth(AUTH_LEASED_JOB),
        fakeProvisionerAuth,
      ],
      routes: runnerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    provisionerTokenId = crypto.randomUUID();
  });

  it('mints one registration token per provisioned runner for a valid reservation', async () => {
    const reservationId = await createReservation({count: 2});
    const before = Date.now();

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a', 'provisioned-runner-b']),
    });

    const after = Date.now();
    expect(res.statusCode).toBe(200);
    const tokens = res.json().tokens as {
      provisioned_runner_id: string;
      registration_token: string;
      expires_at: string;
    }[];
    expect(tokens).toHaveLength(2);
    expect(tokens.map((token) => token.provisioned_runner_id).sort()).toEqual([
      'provisioned-runner-a',
      'provisioned-runner-b',
    ]);
    for (const minted of tokens) {
      expect(
        minted.registration_token.startsWith(`sf_${tokenTypeParts.ephemeralRegistrationToken}_`),
      ).toBe(true);
      const persisted = await resolveEphemeralRegistrationTokenByHash(
        hashOpaqueToken(minted.registration_token),
      );
      expect(persisted).toMatchObject({
        workspaceId,
        provisionerId: provisionerTokenId,
        reservationId,
        provisionedRunnerId: minted.provisioned_runner_id,
      });
      const expiresMs = new Date(minted.expires_at).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(
        before + config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS * 1000,
      );
      expect(expiresMs).toBeLessThanOrEqual(
        after + config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS * 1000,
      );
    }
  });

  it('returns 404 when the reservation is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(crypto.randomUUID(), ['provisioned-runner-a']),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('reservation-not-found');
  });

  it('returns 404 when the reservation belongs to another provisioner', async () => {
    const reservationId = await createReservation({
      count: 1,
      provisionerId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a']),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('reservation-not-found');
  });

  it('returns 404 when the reservation belongs to another workspace', async () => {
    const reservationId = await createReservation({
      count: 1,
      workspaceId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a']),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('reservation-not-found');
  });

  it('returns 409 when the reservation is expired', async () => {
    const reservationId = await createReservation({
      count: 1,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a']),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('reservation-expired');
  });

  it('allows a batch equal to the reservation count', async () => {
    const reservationId = await createReservation({count: 2});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a', 'provisioned-runner-b']),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokens).toHaveLength(2);
  });

  it('returns 409 when the batch exceeds the reservation count', async () => {
    const reservationId = await createReservation({count: 1});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a', 'provisioned-runner-b']),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'batch-exceeds-reservation',
      details: {requested: 2, reservation_count: 1},
    });
  });

  it('rejects the whole batch when a requested provisioned runner has an active token', async () => {
    const reservationId = await createReservation({count: 2});
    await ephemeralRegistrationTokenFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      provisionedRunnerId: 'provisioned-runner-a',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a', 'provisioned-runner-b']),
    });

    const persistedCount = await countEphemeralTokens();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'registration-token-active',
      details: {provisioned_runner_ids: ['provisioned-runner-a']},
    });
    expect(persistedCount).toBe(1);
  });

  it('returns 400 for duplicate provisioned runner ids', async () => {
    const reservationId = await createReservation({count: 2});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a', 'provisioned-runner-a']),
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when the request exceeds the runtime batch max', async () => {
    const reservationId = await createReservation({count: config.REGISTRATION_TOKEN_BATCH_MAX + 1});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(
        reservationId,
        Array.from(
          {length: config.REGISTRATION_TOKEN_BATCH_MAX + 1},
          (_, index) => `provisioned-runner-${index}`,
        ),
      ),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'batch-too-large',
      details: {requested: config.REGISTRATION_TOKEN_BATCH_MAX + 1},
    });
  });

  it('returns 400 when the request exceeds the DTO hard ceiling', async () => {
    const reservationId = await createReservation({count: 1001});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(
        reservationId,
        Array.from({length: 1001}, (_, index) => `provisioned-runner-${index}`),
      ),
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 429 when the provisioner mint rate limit is exceeded', async () => {
    const reservationId = await createReservation({count: 1});
    await seedProvisionerMintRateLimit(config.PROVISIONER_MINT_RATE_LIMIT_MAX_REQUESTS);

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a']),
    });

    const persistedCount = await countEphemeralTokens();
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toEqual(expect.any(String));
    expect(res.json()).toMatchObject({
      code: 'rate-limited',
      details: {retry_after_seconds: expect.any(Number)},
    });
    expect(persistedCount).toBe(0);
  });

  it('returns 503 when the provisioner mint rate limiter is unavailable', async () => {
    const reservationId = await createReservation({count: 1});
    const identifierHmac = await seedProvisionerMintRateLimit(1);

    await db().transaction(async (tx) => {
      await tx.execute(sql`
        SELECT 1
        FROM runners_rate_limits
        WHERE identifier_hmac = ${identifierHmac}
        FOR UPDATE
      `);

      const res = await app.inject({
        method: 'POST',
        url: '/provisioners/runner-registration-tokens/batch',
        headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
        payload: body(reservationId, ['provisioned-runner-a']),
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('runners-rate-limit-unavailable');
    });

    const persistedCount = await countEphemeralTokens();
    expect(persistedCount).toBe(0);
  });

  it('mints tokens that can register exactly once', async () => {
    const reservationId = await createReservation({count: 1});
    const mint = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['provisioned-runner-a']),
    });
    const registrationToken = mint.json().tokens[0].registration_token as string;

    const first = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${registrationToken}`},
      payload: {labels: ['linux']},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${registrationToken}`},
      payload: {labels: ['linux']},
    });

    expect(mint.statusCode).toBe(200);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({mode: 'ephemeral', max_claims: 1});
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('registration-token-consumed');
  });

  async function createReservation(params: {
    count: number;
    workspaceId?: string;
    provisionerId?: string;
    expiresAt?: Date;
  }): Promise<string> {
    const [reservation] = await db()
      .insert(reservations)
      .values({
        workspaceId: params.workspaceId ?? workspaceId,
        provisionerId: params.provisionerId ?? provisionerTokenId,
        requiredLabels: ['linux'],
        count: params.count,
        expiresAt: params.expiresAt ?? new Date(Date.now() + 60_000),
      })
      .returning({id: reservations.id});
    if (!reservation) throw new Error('Insert returned no rows');
    return reservation.id;
  }

  async function countEphemeralTokens(): Promise<number> {
    const [row] = await db()
      .select({value: count()})
      .from(ephemeralRegistrationTokens)
      .where(
        and(
          eq(ephemeralRegistrationTokens.workspaceId, workspaceId),
          eq(ephemeralRegistrationTokens.provisionerId, provisionerTokenId),
        ),
      );
    return row?.value ?? 0;
  }

  function body(reservationId: string, provisionedRunnerIds: string[]) {
    return {
      reservation_id: reservationId,
      provisioned_runners: provisionedRunnerIds.map((provisionedRunnerId) => ({
        provisioned_runner_id: provisionedRunnerId,
      })),
    };
  }

  async function seedProvisionerMintRateLimit(seedCount: number): Promise<string> {
    const identifierHmac = hashRunnersRateLimitIdentifier({
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier: provisionerTokenId,
    });
    const windows = rateLimitWindows(config.PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS);

    await db()
      .insert(runnersRateLimits)
      .values(
        windows.map((windowStart) => ({
          action: 'provisioner-mint',
          scope: 'provisioner',
          identifierHmac,
          windowStart,
          count: seedCount,
          expiresAt: new Date(
            windowStart.getTime() + config.PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS * 1000,
          ),
        })),
      );

    return identifierHmac;
  }

  function rateLimitWindows(windowSeconds: number): [Date, Date] {
    const windowMs = windowSeconds * 1000;
    const currentWindowStart = Math.floor(Date.now() / windowMs) * windowMs;
    return [new Date(currentWindowStart), new Date(currentWindowStart + windowMs)];
  }
});
