import {AUTH_PROVISIONER_TOKEN, AUTH_USER} from '@shipfox/api-auth-context';
import type {AuthMethod} from '@shipfox/node-fastify';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {generateOpaqueToken} from '@shipfox/node-tokens';
import type {FastifyInstance} from 'fastify';
import {createInstallationProvisionerToken} from '#core/provisioner-tokens.js';
import * as provisionerTokenDb from '#db/provisioner-tokens.js';
import {
  revokeInstallationProvisionerToken,
  revokeProvisionerToken,
} from '#db/provisioner-tokens.js';
import {createProvisionerTokenAuthMethod} from '#presentation/auth/index.js';
import {provisionerTokenFactory} from '#test/index.js';
import {provisionerRoutes} from './index.js';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: () => Promise.resolve(),
};

describe('provisioner me route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    await closeApp();
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
    expect(res.json()).toEqual({id: token.id, scope: 'workspace', workspace_id: workspaceId});
    const touched = await provisionerTokenDb.resolveProvisionerTokenByHash(token.hashedToken);
    expect(touched?.lastSeenAt).toBeInstanceOf(Date);
  });

  it('returns an installation identity without a workspace', async () => {
    const token = await createInstallationProvisionerToken({createdByUserId: crypto.randomUUID()});

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${token.rawToken}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({id: token.token.id, scope: 'installation'});
  });

  it('rejects a revoked installation provisioner token', async () => {
    const token = await createInstallationProvisionerToken({createdByUserId: crypto.randomUUID()});
    await revokeInstallationProvisionerToken({
      tokenId: token.token.id,
      revokedByUserId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${token.rawToken}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('provisioner-token-revoked');
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
    expect(res.json()).toEqual({id: token.id, scope: 'workspace', workspace_id: workspaceId});
  });

  it('returns 401 without an authorization header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  it('returns 401 for a non-provisioner token type before lookup', async () => {
    const rawToken = generateOpaqueToken('manualRegistrationToken');

    const res = await app.inject({
      method: 'GET',
      url: '/provisioners/me',
      headers: {authorization: `Bearer ${rawToken}`},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
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
});
