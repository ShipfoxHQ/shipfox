import {
  createLeaseTokenAuthMethod,
  createRunnerSessionAuthMethod,
  verifyRunnerSessionToken,
} from '@shipfox/api-auth';
import {AUTH_API_KEY, AUTH_USER} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {revokeRunnerToken} from '#db/runner-tokens.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {createRunnerTokenAuthMethod} from '#presentation/auth/index.js';
import {runnerTokenFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

const fakeApiKeyAuth: AuthMethod = {
  name: AUTH_API_KEY,
  authenticate: () => Promise.resolve(),
};

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

describe('POST /runners/register', () => {
  let app: FastifyInstance;
  let rawToken: string;
  let workspaceId: string;

  beforeAll(async () => {
    app = await createApp({
      auth: [
        fakeApiKeyAuth,
        fakeUserAuth,
        createRunnerTokenAuthMethod(),
        createRunnerSessionAuthMethod(),
        createLeaseTokenAuthMethod(),
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
    await db().execute(sql`TRUNCATE runners_runner_sessions, runners_runner_tokens CASCADE`);
    rawToken = `sf_r_${crypto.randomUUID()}`;
    workspaceId = crypto.randomUUID();
    await runnerTokenFactory.create({workspaceId}, {transient: {rawToken}});
  });

  it('exchanges a registration token for a manual runner session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['Linux', 'x64', 'linux']},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.session_token).toBe('string');
    expect(body.session_id).toEqual(expect.any(String));
    expect(body.mode).toBe('manual');
    expect(body.max_claims).toBeNull();

    const claims = await verifyRunnerSessionToken(body.session_token);
    expect(claims).toMatchObject({
      runnerSessionId: body.session_id,
      workspaceId,
      scope: 'workspace',
      labels: ['linux', 'x64'],
    });

    const rows = await db()
      .select()
      .from(runnerSessions)
      .where(eq(runnerSessions.id, body.session_id));
    expect(rows[0]?.labels).toEqual(['linux', 'x64']);
  });

  it('creates independent sessions from the same registration token', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['linux']},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload: {labels: ['macos']},
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().session_id).not.toBe(second.json().session_id);

    const rows = await db().select().from(runnerSessions);
    expect(rows.map((row) => row.labels).sort()).toEqual([['linux'], ['macos']]);
  });

  it('returns 401 when the registration token is expired', async () => {
    const expiredRawToken = `sf_r_${crypto.randomUUID()}`;
    await runnerTokenFactory.create(
      {workspaceId, expiresAt: new Date(Date.now() - 1000)},
      {transient: {rawToken: expiredRawToken}},
    );

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${expiredRawToken}`},
      payload: {labels: ['linux']},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('runner-token-expired');
  });

  it('returns 401 when the registration token is revoked', async () => {
    const revokedRawToken = `sf_r_${crypto.randomUUID()}`;
    const token = await runnerTokenFactory.create(
      {workspaceId},
      {transient: {rawToken: revokedRawToken}},
    );
    await revokeRunnerToken({tokenId: token.id, workspaceId});

    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${revokedRawToken}`},
      payload: {labels: ['linux']},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('runner-token-revoked');
  });

  it.each([
    ['too many labels', {labels: Array.from({length: 51}, (_, index) => `label-${index}`)}],
    ['too long label', {labels: ['a'.repeat(64)]}],
    ['bad charset', {labels: ['linux/amd64']}],
  ])('returns 400 for %s', async (_case, payload) => {
    const res = await app.inject({
      method: 'POST',
      url: '/runners/register',
      headers: {authorization: `Bearer ${rawToken}`},
      payload,
    });

    expect(res.statusCode).toBe(400);
  });
});
