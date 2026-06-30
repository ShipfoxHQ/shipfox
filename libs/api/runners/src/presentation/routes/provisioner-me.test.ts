import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import {getWorkspace, WorkspaceNotFoundError} from '@shipfox/api-workspaces';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {generateOpaqueToken} from '@shipfox/node-tokens';
import {sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import * as provisionerTokenDb from '#db/provisioner-tokens.js';
import {revokeProvisionerToken} from '#db/provisioner-tokens.js';
import {createProvisionerTokenAuthMethod} from '#presentation/auth/index.js';
import {provisionerTokenFactory} from '#test/index.js';
import {provisionerRoutes} from './index.js';

const mocks = vi.hoisted(() => ({
  logger: {
    child: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

mocks.logger.child.mockReturnValue(mocks.logger);

vi.mock('@shipfox/node-opentelemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-opentelemetry')>()),
  logger: () => mocks.logger,
}));

vi.mock('@shipfox/api-workspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/api-workspaces')>()),
  getWorkspace: vi.fn(),
}));

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

describe('provisioner me route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await closeApp();
    await db().execute(sql`TRUNCATE runners_provisioner_tokens CASCADE`);
    mocks.logger.warn.mockReset();
    vi.mocked(getWorkspace).mockImplementation(({workspaceId}) =>
      Promise.resolve(workspace({id: workspaceId})),
    );
    app = await createApp({
      auth: [fakeUserAuth, createProvisionerTokenAuthMethod()],
      routes: provisionerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('uses provisioner auth for provisioner routes', () => {
    expect(provisionerRoutes[2]?.auth).toBe(AUTH_PROVISIONER_TOKEN);
  });

  it('returns the authenticated provisioner identity', async () => {
    const workspaceId = crypto.randomUUID();
    const rawToken = generateOpaqueToken('provisionerToken');
    const token = await provisionerTokenFactory.create({workspaceId}, {transient: {rawToken}});

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({id: token.id, workspace_id: workspaceId});
  });

  it('does not reject valid auth when the last-seen write fails', async () => {
    await closeApp();
    const workspaceId = crypto.randomUUID();
    const rawToken = generateOpaqueToken('provisionerToken');
    const token = await provisionerTokenFactory.create({workspaceId}, {transient: {rawToken}});
    vi.spyOn(provisionerTokenDb, 'touchProvisionerLastSeen').mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    app = await createApp({
      auth: [fakeUserAuth, createProvisionerTokenAuthMethod()],
      routes: provisionerRoutes,
      swagger: false,
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({id: token.id, workspace_id: workspaceId});
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      {error: expect.any(Error), provisionerTokenId: token.id},
      'last-seen touch failed',
    );
  });

  it('returns 401 without an authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      {prefix: undefined, reason: 'missing'},
      'provisioner token auth failed',
    );
  });

  it('returns 401 for a non-provisioner token type before lookup', async () => {
    const rawToken = generateOpaqueToken('runnerToken');

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      {prefix: rawToken.slice(0, 12), reason: 'type'},
      'provisioner token auth failed',
    );
  });

  it('returns 401 for an unknown provisioner token', async () => {
    const rawToken = generateOpaqueToken('provisionerToken');

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      {prefix: rawToken.slice(0, 12), reason: 'not-found'},
      'provisioner token auth failed',
    );
  });

  it('returns 401 for a revoked provisioner token', async () => {
    const workspaceId = crypto.randomUUID();
    const rawToken = generateOpaqueToken('provisionerToken');
    const token = await provisionerTokenFactory.create({workspaceId}, {transient: {rawToken}});
    await revokeProvisionerToken({
      tokenId: token.id,
      workspaceId,
      revokedByUserId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('provisioner-token-revoked');
  });

  it('returns 401 for an expired provisioner token', async () => {
    const workspaceId = crypto.randomUUID();
    const rawToken = generateOpaqueToken('provisionerToken');
    await provisionerTokenFactory.create(
      {workspaceId, expiresAt: new Date(Date.now() - 60_000)},
      {transient: {rawToken}},
    );

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('provisioner-token-expired');
  });

  it('returns 401 for a provisioner token expiring at the current instant', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const workspaceId = crypto.randomUUID();
    const rawToken = generateOpaqueToken('provisionerToken');
    await provisionerTokenFactory.create({workspaceId, expiresAt: now}, {transient: {rawToken}});

    vi.useFakeTimers();
    vi.setSystemTime(now);
    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });
    vi.useRealTimers();

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('provisioner-token-expired');
  });

  it('returns 401 for a provisioner token whose workspace does not exist', async () => {
    const workspaceId = crypto.randomUUID();
    const rawToken = generateOpaqueToken('provisionerToken');
    await provisionerTokenFactory.create({workspaceId}, {transient: {rawToken}});
    vi.mocked(getWorkspace).mockRejectedValueOnce(new WorkspaceNotFoundError(workspaceId));

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      {prefix: rawToken.slice(0, 12), reason: 'workspace-not-found'},
      'provisioner token auth failed',
    );
  });

  it('returns 403 for a provisioner token in a suspended workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const rawToken = generateOpaqueToken('provisionerToken');
    await provisionerTokenFactory.create({workspaceId}, {transient: {rawToken}});
    vi.mocked(getWorkspace).mockResolvedValueOnce(
      workspace({id: workspaceId, status: 'suspended'}),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('workspace-inactive');
  });
});

function workspace(params: {id: string; status?: 'active' | 'suspended' | 'deleted'}) {
  return {
    id: params.id,
    name: 'Test Workspace',
    status: params.status ?? 'active',
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
