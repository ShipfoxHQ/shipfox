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
import {count, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {config} from '#config.js';
import {db} from '#db/db.js';
import {resolveEphemeralRegistrationTokenByHash} from '#db/ephemeral-registration-tokens.js';
import {ephemeralRegistrationTokens} from '#db/schema/ephemeral-registration-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {createRunnerTokenAuthMethod} from '#presentation/auth/index.js';
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
      setProvisionerContext(request, {workspaceId, provisionerTokenId});
      return Promise.resolve();
    },
  };

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeUserAuth,
        createRunnerTokenAuthMethod(),
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

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_runner_sessions, runners_reservations CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    provisionerTokenId = crypto.randomUUID();
  });

  it('mints one registration token per resource for a valid reservation', async () => {
    const reservationId = await createReservation({count: 2});
    const before = Date.now();

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['resource-a', 'resource-b']),
    });

    const after = Date.now();
    expect(res.statusCode).toBe(200);
    const tokens = res.json().tokens as {
      resource_id: string;
      registration_token: string;
      expires_at: string;
    }[];
    expect(tokens).toHaveLength(2);
    expect(tokens.map((token) => token.resource_id).sort()).toEqual(['resource-a', 'resource-b']);
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
        resourceId: minted.resource_id,
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
      payload: body(crypto.randomUUID(), ['resource-a']),
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
      payload: body(reservationId, ['resource-a']),
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
      payload: body(reservationId, ['resource-a']),
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
      payload: body(reservationId, ['resource-a']),
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
      payload: body(reservationId, ['resource-a', 'resource-b']),
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
      payload: body(reservationId, ['resource-a', 'resource-b']),
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'batch-exceeds-reservation',
      details: {requested: 2, reservation_count: 1},
    });
  });

  it('rejects the whole batch when a requested resource has an active token', async () => {
    const reservationId = await createReservation({count: 2});
    await ephemeralRegistrationTokenFactory.create({
      workspaceId,
      provisionerId: provisionerTokenId,
      resourceId: 'resource-a',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['resource-a', 'resource-b']),
    });

    const persistedCount = await countEphemeralTokens();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'registration-token-active',
      details: {resource_ids: ['resource-a']},
    });
    expect(persistedCount).toBe(1);
  });

  it('returns 400 for duplicate resource ids', async () => {
    const reservationId = await createReservation({count: 2});

    const res = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['resource-a', 'resource-a']),
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
          (_, index) => `resource-${index}`,
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
        Array.from({length: 1001}, (_, index) => `resource-${index}`),
      ),
    });

    expect(res.statusCode).toBe(400);
  });

  it('mints tokens that can register exactly once', async () => {
    const reservationId = await createReservation({count: 1});
    const mint = await app.inject({
      method: 'POST',
      url: '/provisioners/runner-registration-tokens/batch',
      headers: {authorization: `Bearer ${VALID_PROVISIONER_TOKEN}`},
      payload: body(reservationId, ['resource-a']),
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
    const [row] = await db().select({value: count()}).from(ephemeralRegistrationTokens);
    return row?.value ?? 0;
  }

  function body(reservationId: string, resourceIds: string[]) {
    return {
      reservation_id: reservationId,
      resources: resourceIds.map((resourceId) => ({
        resource_id: resourceId,
      })),
    };
  }
});
