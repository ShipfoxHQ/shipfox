import {createLeaseTokenAuthMethod, createRunnerSessionAuthMethod} from '@shipfox/api-auth';
import {
  AUTH_LEASED_JOB,
  AUTH_PROVISIONER_TOKEN,
  AUTH_RUNNER_REGISTRATION_TOKEN,
  AUTH_RUNNER_SESSION,
  AUTH_USER,
  buildUserContext,
  setUserContext,
} from '@shipfox/api-auth-context';
import {requireMembership} from '@shipfox/api-workspaces';
import type {AuthMethod} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {hashOpaqueToken, tokenTypeParts} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {revokeManualRegistrationToken} from '#db/manual-registration-tokens.js';
import {manualRegistrationTokens} from '#db/schema/manual-registration-tokens.js';
import {createRunnerRegistrationTokenAuthMethod} from '#presentation/auth/index.js';
import {manualRegistrationTokenFactory} from '#test/index.js';
import {runnerRoutes} from './index.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(),
}));

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: [{workspaceId: 'workspace-from-auth', role: 'admin'}],
      }),
    );
    return Promise.resolve();
  },
};

const fakeProvisionerAuth: AuthMethod = {
  name: AUTH_PROVISIONER_TOKEN,
  authenticate: () => Promise.resolve(),
};

describe('manual registration token routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    await db().execute(
      sql`TRUNCATE runners_ephemeral_registration_tokens, runners_manual_registration_tokens CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    vi.mocked(requireMembership).mockResolvedValue({
      workspaceId,
      workspace: {
        id: workspaceId,
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
      role: 'admin',
    });
    app = await createApp({
      auth: [
        fakeUserAuth,
        createRunnerRegistrationTokenAuthMethod(),
        createRunnerSessionAuthMethod(),
        createLeaseTokenAuthMethod(),
        fakeProvisionerAuth,
      ],
      routes: runnerRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('uses the expected auth method for each runner route group', () => {
    expect(runnerRoutes[0]?.auth).toBe(AUTH_USER);
    expect(runnerRoutes[1]?.auth).toBe(AUTH_USER);
    expect(runnerRoutes[2]?.auth).toBe(AUTH_RUNNER_REGISTRATION_TOKEN);
    expect(runnerRoutes[3]?.auth).toBe(AUTH_RUNNER_SESSION);
    expect(runnerRoutes[4]?.auth).toBe(AUTH_LEASED_JOB);
    expect(runnerRoutes[5]?.auth).toBe(AUTH_PROVISIONER_TOKEN);
  });

  describe('GET /workspaces/:workspaceId/runners/manual-registration-tokens', () => {
    it('returns 401 without client auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects API-key-only requests', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
        headers: {authorization: `Bearer api:${workspaceId}`},
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });

    it('returns 403 when the user is not a workspace member', async () => {
      vi.mocked(requireMembership).mockRejectedValueOnce(
        new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('forbidden');
    });

    it('returns only usable tokens for the workspace', async () => {
      const usable = await manualRegistrationTokenFactory.create({workspaceId, name: 'usable'});
      const expired = await manualRegistrationTokenFactory.create({
        workspaceId,
        name: 'expired',
        expiresAt: new Date(Date.now() - 60_000),
      });
      const revoked = await manualRegistrationTokenFactory.create({workspaceId, name: 'revoked'});
      await manualRegistrationTokenFactory.create({
        workspaceId: crypto.randomUUID(),
        name: 'other workspace',
      });
      await revokeManualRegistrationToken({tokenId: revoked.id, workspaceId});

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().manual_registration_tokens.map((token: {id: string}) => token.id)).toEqual([
        usable.id,
      ]);
      expect(
        res.json().manual_registration_tokens.map((token: {id: string}) => token.id),
      ).not.toContain(expired.id);
    });
  });

  describe('POST /workspaces/:workspaceId/runners/manual-registration-tokens', () => {
    it('returns 401 without client auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
        payload: {name: 'builder'},
      });

      expect(res.statusCode).toBe(401);
    });

    it('creates a workspace-scoped manual registration token and returns the raw token once', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens`,
        headers: {authorization: 'Bearer user'},
        payload: {name: 'builder', ttl_seconds: 3600},
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.raw_token.startsWith(`sf_${tokenTypeParts.manualRegistrationToken}_`)).toBe(true);
      expect(body.prefix).toBe(body.raw_token.slice(0, 12));
      expect(body.name).toBe('builder');
      expect(body.workspace_id).toBe(workspaceId);
      expect(body.expires_at).not.toBeNull();

      const rows = await db()
        .select()
        .from(manualRegistrationTokens)
        .where(eq(manualRegistrationTokens.id, body.id));
      expect(rows[0]?.hashedToken).toBe(hashOpaqueToken(body.raw_token));
      expect(rows[0]?.hashedToken).not.toBe(body.raw_token);
    });
  });

  describe('POST /workspaces/:workspaceId/runners/manual-registration-tokens/:tokenId/revoke', () => {
    it('revokes a token owned by the authenticated workspace', async () => {
      const token = await manualRegistrationTokenFactory.create({workspaceId});

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens/${token.id}/revoke`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(token.id);
      expect(res.json().revoked_at).not.toBeNull();
    });

    it('returns 404 for a token owned by another workspace', async () => {
      const token = await manualRegistrationTokenFactory.create({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/runners/manual-registration-tokens/${token.id}/revoke`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not-found');
    });
  });
});
