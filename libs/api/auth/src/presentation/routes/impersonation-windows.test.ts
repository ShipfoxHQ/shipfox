import {
  impersonationWindowContinueResponseSchema,
  impersonationWindowExactResponseSchema,
  impersonationWindowStartResponseSchema,
  impersonationWindowStopResponseSchema,
  impersonationWindowsResponseSchema,
} from '@shipfox/api-auth-dto';
import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {verifyUserToken} from '#core/jwt.js';
import {db} from '#db/db.js';
import {adminCommandResults} from '#db/schema/admin-command-results.js';
import {impersonationWindows} from '#db/schema/impersonation-windows.js';
import {authOutbox} from '#db/schema/outbox.js';
import * as authMetrics from '#metrics/index.js';
import {impersonationWindowFactory} from '#test/index.js';
import {
  createAuthTestApp,
  createVerifiedSession,
  getWorkspaceOperatingStateMock,
  listMembershipsByUserMock,
  missingWorkspaceError,
  resetCapturedMail,
  setAuthJwtExpiresIn,
  setImpersonationEnabled,
} from '#test/routes.js';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';

function authHeaders(token: string, idempotencyKey: string, requestId?: string) {
  return {
    authorization: `Bearer ${token}`,
    'idempotency-key': idempotencyKey,
    ...(requestId ? {'x-request-id': requestId} : {}),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return {promise, resolve};
}

async function resetState(): Promise<void> {
  await db().execute(
    sql`TRUNCATE auth_impersonation_windows, auth_admin_command_results, auth_admin_grants, auth_outbox, auth_rate_limits CASCADE`,
  );
  resetCapturedMail();
  setImpersonationEnabled(true);
  setAuthJwtExpiresIn('15m');
}

describe('impersonation window routes', () => {
  let app: Awaited<ReturnType<typeof createAuthTestApp>>;

  beforeAll(async () => {
    app = await createAuthTestApp({fastifyOptions: {requestIdHeader: 'x-request-id'}});
  });

  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await resetState();
    await app.close();
  });

  async function bootstrapOwner(prefix: string) {
    const owner = await createVerifiedSession(`${prefix}-owner`);
    const response = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants/bootstrap',
      headers: authHeaders(owner.token, `${prefix}-bootstrap`),
      payload: {bootstrap_token: BOOTSTRAP_TOKEN},
    });
    expect(response.statusCode).toBe(201);
    return owner;
  }

  async function startWindow(params: {
    token: string;
    workspaceId?: string;
    key: string;
    reason?: string | null;
    requestId?: string;
  }) {
    return await app.inject({
      method: 'POST',
      url: '/admin/auth/impersonation/windows',
      headers: authHeaders(params.token, params.key, params.requestId),
      payload: {
        workspace_id: params.workspaceId ?? crypto.randomUUID(),
        ...(params.reason === null ? {} : {reason: params.reason ?? 'Support reproduction'}),
      },
    });
  }

  async function actionEvents() {
    const rows = await db().select().from(authOutbox).orderBy(authOutbox.createdAt);
    return rows.filter(
      (row) =>
        row.eventType === ADMINISTRATION_ACTION_PERFORMED &&
        typeof row.payload === 'object' &&
        row.payload !== null &&
        'command' in row.payload &&
        String(row.payload.command).startsWith('auth.impersonation.window.'),
    );
  }

  test('records shared and window-specific outcomes for a successful Window Start', async () => {
    const owner = await bootstrapOwner('window-start-metrics-success');
    const recordOutcome = vi.spyOn(authMetrics, 'recordImpersonationOutcome');
    const recordWindowStartOutcome = vi.spyOn(authMetrics, 'recordImpersonationWindowStartOutcome');

    const started = await startWindow({
      token: owner.token,
      key: 'window-start-metrics-success-start',
    });

    expect(started.statusCode).toBe(200);
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome).toHaveBeenCalledWith('succeeded');
    expect(recordWindowStartOutcome).toHaveBeenCalledTimes(1);
    expect(recordWindowStartOutcome).toHaveBeenCalledWith('succeeded');
  });

  test('records shared and window-specific outcomes for a denied Window Start', async () => {
    const owner = await bootstrapOwner('window-start-metrics-denied');
    setImpersonationEnabled(false);
    const recordOutcome = vi.spyOn(authMetrics, 'recordImpersonationOutcome');
    const recordWindowStartOutcome = vi.spyOn(authMetrics, 'recordImpersonationWindowStartOutcome');

    const rejected = await startWindow({
      token: owner.token,
      key: 'window-start-metrics-denied-start',
    });

    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({code: 'impersonation-disabled'});
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(recordOutcome).toHaveBeenCalledWith('failed');
    expect(recordWindowStartOutcome).toHaveBeenCalledTimes(1);
    expect(recordWindowStartOutcome).toHaveBeenCalledWith('failed');
  });

  test('registers the complete protocol and makes Stop terminal and idempotent', async () => {
    const owner = await bootstrapOwner('window-protocol');

    const workspaceId = crypto.randomUUID();

    const started = await startWindow({
      token: owner.token,
      workspaceId,
      key: 'window-start',
      requestId: 'window-protocol-start',
    });
    expect(started.statusCode).toBe(200);
    const startBody = impersonationWindowStartResponseSchema.parse(started.json());
    expect(started.headers['set-cookie']).toBeUndefined();
    expect(startBody.window_id).toEqual(expect.any(String));
    expect(JSON.stringify(started.json())).not.toContain('window-start');

    const listed = await app.inject({
      method: 'GET',
      url: '/admin/auth/impersonation/windows?scope=owned',
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(listed.statusCode).toBe(200);
    expect(impersonationWindowsResponseSchema.parse(listed.json()).windows).toEqual([
      expect.objectContaining({
        window_id: startBody.window_id,
        reason: 'Support reproduction',
        actor: expect.objectContaining({id: owner.userId}),
        workspace_id: workspaceId,
        target: null,
      }),
    ]);

    const continued = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${startBody.window_id}/continue`,
      headers: authHeaders(owner.token, 'window-continue', 'window-protocol-continue'),
      payload: {},
    });
    expect(continued.statusCode).toBe(200);
    const continueBody = impersonationWindowContinueResponseSchema.parse(continued.json());
    expect(continueBody.token).not.toBe(startBody.token);
    expect(continueBody.window_deadline).toBe(startBody.window_deadline);
    const claims = await verifyUserToken({token: continueBody.token, secret: userAccessTokenKey()});
    expect(claims.sub).toBe(owner.userId);
    expect(claims.impersonatorId).toBe(owner.userId);
    expect(claims.memberships).toEqual([
      {
        workspaceId,
        workspaceSlug: `ws-${workspaceId.slice(0, 8)}`,
        role: 'admin',
        workspaceStatus: 'active',
      },
    ]);
    expect(continueBody.workspace_id).toBe(workspaceId);
    expect(continueBody.user.id).toBe(owner.userId);
    expect(claims.exp * 1000).toBeLessThanOrEqual(Date.parse(continueBody.window_deadline));

    const replayedContinue = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${startBody.window_id}/continue`,
      headers: authHeaders(owner.token, 'window-continue'),
      payload: {},
    });
    expect(replayedContinue.statusCode).toBe(200);
    const replayBody = impersonationWindowContinueResponseSchema.parse(replayedContinue.json());
    expect(replayBody.token).not.toBe(continueBody.token);
    expect(replayBody.expires_at).toBe(continueBody.expires_at);
    const replayClaims = await verifyUserToken({
      token: replayBody.token,
      secret: userAccessTokenKey(),
    });
    expect(replayClaims.exp * 1000).toBe(Date.parse(replayBody.expires_at));
    expect(replayClaims.sub).toBe(owner.userId);
    expect(replayClaims.memberships).toEqual(claims.memberships);
    expect(replayBody.window_deadline).toBe(startBody.window_deadline);

    const stopped = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${startBody.window_id}/stop`,
      headers: authHeaders(owner.token, 'window-stop', 'window-protocol-stop'),
      payload: {},
    });
    expect(stopped.statusCode).toBe(200);
    expect(impersonationWindowStopResponseSchema.parse(stopped.json())).toMatchObject({
      window_id: startBody.window_id,
      state: 'stopped',
    });

    const repeatedStop = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${startBody.window_id}/stop`,
      headers: authHeaders(owner.token, 'window-stop'),
      payload: {},
    });
    expect(repeatedStop.statusCode).toBe(200);
    expect(repeatedStop.json()).toEqual(stopped.json());

    const exact = await app.inject({
      method: 'GET',
      url: `/admin/auth/impersonation/windows/${startBody.window_id}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(exact.statusCode).toBe(200);
    expect(impersonationWindowExactResponseSchema.parse(exact.json())).toMatchObject({
      window_id: startBody.window_id,
      actor_role_at_start: 'admin-owner',
      state: 'stopped',
      ended_reason: 'stopped',
    });
    expect(JSON.stringify(exact.json())).not.toContain(startBody.token);

    const events = await actionEvents();
    expect(events.map((event) => (event.payload as {command: string}).command)).toEqual([
      'auth.impersonation.window.start',
      'auth.impersonation.window.continue',
      'auth.impersonation.window.continue',
      'auth.impersonation.window.stop',
    ]);
    expect((events[0]?.payload as {correlationId: string}).correlationId).toBe(
      'window-protocol-start',
    );
    expect(events[0]?.payload).toMatchObject({targetType: 'workspace', targetId: workspaceId});
    expect((events[1]?.payload as {correlationId: string}).correlationId).toBe(
      'window-protocol-continue',
    );
    expect((events[3]?.payload as {correlationId: string}).correlationId).toBe(
      'window-protocol-stop',
    );
    expect(events.at(-1)?.payload).toMatchObject({
      authorizationBasis: 'impersonation-window-owner',
      actorRole: null,
      requiredRole: null,
      actorRoleAtStart: 'admin-owner',
      targetType: 'impersonation-window',
      targetId: startBody.window_id,
    });
  });

  test('returns the Window Start role separately from the actor current role', async () => {
    const owner = await bootstrapOwner('window-historical-role');
    const actor = await createVerifiedSession('window-historical-role-actor');

    const operatorGrant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'window-historical-role-operator-grant'),
      payload: {user_id: actor.userId, role: 'admin-operator', reason: 'Window actor'},
    });
    expect(operatorGrant.statusCode).toBe(201);

    const started = await startWindow({
      token: actor.token,
      key: 'window-historical-role-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const ownerGrant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'window-historical-role-owner-grant'),
      payload: {user_id: actor.userId, role: 'admin-owner', reason: 'Promote window actor'},
    });
    expect(ownerGrant.statusCode).toBe(201);

    const exact = await app.inject({
      method: 'GET',
      url: `/admin/auth/impersonation/windows/${windowId}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(exact.statusCode).toBe(200);
    expect(impersonationWindowExactResponseSchema.parse(exact.json())).toMatchObject({
      actor: expect.objectContaining({admin_role: 'admin-owner'}),
      actor_role_at_start: 'admin-operator',
    });
  });

  test('keeps reads and owned Stop available when minting is disabled', async () => {
    const owner = await bootstrapOwner('window-disabled');
    const started = await startWindow({
      token: owner.token,
      key: 'window-disabled-start',
    });
    const startBody = impersonationWindowStartResponseSchema.parse(started.json());
    setImpersonationEnabled(false);

    const listed = await app.inject({
      method: 'GET',
      url: '/admin/auth/impersonation/windows',
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(listed.statusCode).toBe(200);

    const continued = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${startBody.window_id}/continue`,
      headers: authHeaders(owner.token, 'window-disabled-continue'),
      payload: {},
    });
    expect(continued.statusCode).toBe(403);
    expect(continued.json()).toEqual({code: 'impersonation-disabled'});

    const stopped = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${startBody.window_id}/stop`,
      headers: authHeaders(owner.token, 'window-disabled-stop'),
      payload: {},
    });
    expect(stopped.statusCode).toBe(200);
  });

  test('hides unknown and other-actor windows as the same 404', async () => {
    const owner = await bootstrapOwner('window-redaction');
    const other = await createVerifiedSession('window-redaction-other');
    const started = await startWindow({
      token: owner.token,
      key: 'window-redaction-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const otherRead = await app.inject({
      method: 'GET',
      url: `/admin/auth/impersonation/windows/${windowId}`,
      headers: {authorization: `Bearer ${other.token}`},
    });
    const unknownRead = await app.inject({
      method: 'GET',
      url: `/admin/auth/impersonation/windows/${crypto.randomUUID()}`,
      headers: {authorization: `Bearer ${other.token}`},
    });
    expect(otherRead.statusCode).toBe(404);
    expect(unknownRead.statusCode).toBe(404);
    expect(otherRead.json()).toEqual(unknownRead.json());

    const otherStop = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/stop`,
      headers: authHeaders(other.token, 'window-redaction-stop'),
      payload: {reason: 'Not my window'},
    });
    expect(otherStop.statusCode).toBe(404);
    expect(otherStop.json()).toEqual({code: 'impersonation-window-not-found'});
  });

  test('rejects a sixth open window before signing', async () => {
    const owner = await bootstrapOwner('window-limit');

    for (let index = 0; index < 5; index += 1) {
      const response = await startWindow({
        token: owner.token,
        key: `window-limit-${index}`,
      });
      expect(response.statusCode).toBe(200);
    }
    const sixth = await startWindow({
      token: owner.token,
      key: 'window-limit-sixth',
    });
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json()).toEqual({code: 'impersonation-window-limit-reached'});
    await expect(
      db()
        .select()
        .from(impersonationWindows)
        .where(eq(impersonationWindows.actorId, owner.userId)),
    ).resolves.toHaveLength(5);
  });

  test('mints the administrator with one admin membership and never loads their own', async () => {
    const owner = await bootstrapOwner('window-workspace');
    const workspaceId = crypto.randomUUID();
    listMembershipsByUserMock.mockClear();
    listMembershipsByUserMock.mockResolvedValue({
      memberships: [{workspaceId: crypto.randomUUID(), role: 'admin', workspaceStatus: 'active'}],
    });

    const started = await startWindow({
      token: owner.token,
      workspaceId: workspaceId.toUpperCase(),
      key: 'window-workspace-start',
    });

    expect(started.statusCode).toBe(200);
    const body = impersonationWindowStartResponseSchema.parse(started.json());
    expect(body.user.id).toBe(owner.userId);
    expect(body.impersonator_id).toBe(owner.userId);
    const claims = await verifyUserToken({token: body.token, secret: userAccessTokenKey()});
    expect(claims.sub).toBe(owner.userId);
    expect(claims.impersonatorId).toBe(owner.userId);
    expect(claims.memberships).toEqual([
      {
        workspaceId: workspaceId.toUpperCase(),
        workspaceSlug: `ws-${workspaceId.toUpperCase().slice(0, 8)}`,
        role: 'admin',
        workspaceStatus: 'active',
      },
    ]);
    expect(listMembershipsByUserMock).not.toHaveBeenCalled();
  });

  test('refuses a marked window session on admin routes', async () => {
    const owner = await bootstrapOwner('window-marked-session');
    const started = await startWindow({token: owner.token, key: 'window-marked-session-start'});
    const body = impersonationWindowStartResponseSchema.parse(started.json());

    const listed = await app.inject({
      method: 'GET',
      url: '/admin/auth/impersonation/windows',
      headers: {authorization: `Bearer ${body.token}`},
    });

    expect(listed.statusCode).toBe(403);
    expect(listed.json()).toMatchObject({code: 'admin-role-required'});
  });

  test.each([
    ['suspended', {status: 'suspended'}],
    ['deleted', {status: 'deleted'}],
  ])('cannot open a window on a %s workspace', async (_label, state) => {
    const owner = await bootstrapOwner('window-workspace-inactive');
    getWorkspaceOperatingStateMock.mockResolvedValue(state);

    const rejected = await startWindow({
      token: owner.token,
      key: 'window-workspace-inactive-start',
    });

    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({code: 'impersonation-workspace-not-active'});
    await expect(db().select().from(impersonationWindows)).resolves.toHaveLength(0);
    const events = await actionEvents();
    expect(events.at(-1)?.payload).toMatchObject({
      command: 'auth.impersonation.window.start',
      targetType: 'workspace',
      result: 'failed',
    });
  });

  test('cannot open a window on a workspace that does not exist', async () => {
    const owner = await bootstrapOwner('window-workspace-missing');
    const workspaceId = crypto.randomUUID();
    getWorkspaceOperatingStateMock.mockRejectedValue(missingWorkspaceError(workspaceId));

    const rejected = await startWindow({
      token: owner.token,
      workspaceId,
      key: 'window-workspace-missing-start',
    });

    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({code: 'impersonation-workspace-not-active'});
  });

  test('refuses a user without the operator role', async () => {
    await bootstrapOwner('window-no-role');
    const outsider = await createVerifiedSession('window-no-role-outsider');

    const rejected = await startWindow({token: outsider.token, key: 'window-no-role-start'});

    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({code: 'forbidden'});
    await expect(db().select().from(impersonationWindows)).resolves.toHaveLength(0);
  });

  test('replays an idempotent Start with the same identity, membership, and deadline', async () => {
    const owner = await bootstrapOwner('window-start-replay');
    const workspaceId = crypto.randomUUID();
    const first = await startWindow({
      token: owner.token,
      workspaceId,
      key: 'window-start-replay-start',
    });
    const replay = await startWindow({
      token: owner.token,
      workspaceId,
      key: 'window-start-replay-start',
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    const firstBody = impersonationWindowStartResponseSchema.parse(first.json());
    const replayBody = impersonationWindowStartResponseSchema.parse(replay.json());
    expect(replayBody.window_id).toBe(firstBody.window_id);
    expect(replayBody.window_deadline).toBe(firstBody.window_deadline);
    expect(replayBody.expires_at).toBe(firstBody.expires_at);
    expect(replayBody.token).not.toBe(firstBody.token);
    const claims = await verifyUserToken({token: replayBody.token, secret: userAccessTokenKey()});
    expect(claims.sub).toBe(owner.userId);
    expect(claims.memberships).toEqual([
      {
        workspaceId,
        workspaceSlug: `ws-${workspaceId.slice(0, 8)}`,
        role: 'admin',
        workspaceStatus: 'active',
      },
    ]);
  });

  test('refuses Continue once the workspace is suspended', async () => {
    const owner = await bootstrapOwner('window-continue-suspended');
    const started = await startWindow({token: owner.token, key: 'window-continue-suspended-start'});
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;
    getWorkspaceOperatingStateMock.mockResolvedValue({status: 'suspended'});

    const continued = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/continue`,
      headers: authHeaders(owner.token, 'window-continue-suspended-continue'),
      payload: {},
    });

    expect(continued.statusCode).toBe(409);
    expect(continued.json()).toEqual({code: 'impersonation-workspace-not-active'});
  });

  test('refuses Continue once the operator role is revoked', async () => {
    const owner = await bootstrapOwner('window-continue-revoked');
    const actor = await createVerifiedSession('window-continue-revoked-actor');
    const grant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'window-continue-revoked-grant'),
      payload: {user_id: actor.userId, role: 'admin-operator', reason: 'Window actor'},
    });
    expect(grant.statusCode).toBe(201);
    const started = await startWindow({token: actor.token, key: 'window-continue-revoked-start'});
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/admin/auth/admin-grants/${grant.json().id}`,
      headers: authHeaders(owner.token, 'window-continue-revoked-revoke'),
      payload: {reason: 'Window actor no longer needs access'},
    });
    expect(revoked.statusCode).toBe(200);

    const continued = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/continue`,
      headers: authHeaders(actor.token, 'window-continue-revoked-continue'),
      payload: {},
    });

    expect(continued.statusCode).toBe(403);
    expect(continued.json()).toMatchObject({code: 'forbidden'});
  });

  test('refuses Continue for a window opened before windows targeted a workspace', async () => {
    const owner = await bootstrapOwner('window-legacy-continue');
    const target = await createVerifiedSession('window-legacy-continue-target');
    const legacy = await impersonationWindowFactory.create({
      actorId: owner.userId,
      targetUserId: target.userId,
      workspaceId: null,
      actorRoleAtStart: 'admin-owner',
    });

    const continued = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${legacy.id}/continue`,
      headers: authHeaders(owner.token, 'window-legacy-continue-continue'),
      payload: {},
    });

    expect(continued.statusCode).toBe(409);
    expect(continued.json()).toEqual({code: 'impersonation-window-stopped'});
    const exact = await app.inject({
      method: 'GET',
      url: `/admin/auth/impersonation/windows/${legacy.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(impersonationWindowExactResponseSchema.parse(exact.json())).toMatchObject({
      workspace_id: null,
      target: expect.objectContaining({id: target.userId}),
    });
  });

  test('commits expiry before Continue returns deadline reached', async () => {
    const owner = await bootstrapOwner('window-expiry');
    const started = await startWindow({
      token: owner.token,
      key: 'window-expiry-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;
    const expiredStartedAt = new Date(Date.now() - 2_000);
    await db()
      .update(impersonationWindows)
      .set({startedAt: expiredStartedAt, deadlineAt: new Date(Date.now() - 1000)})
      .where(eq(impersonationWindows.id, windowId));

    const continued = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/continue`,
      headers: authHeaders(owner.token, 'window-expiry-continue'),
      payload: {},
    });
    expect(continued.statusCode).toBe(410);
    expect(continued.json()).toEqual({code: 'impersonation-window-deadline-reached'});
    const row = await db()
      .select({
        endedAt: impersonationWindows.endedAt,
        endedReason: impersonationWindows.endedReason,
      })
      .from(impersonationWindows)
      .where(eq(impersonationWindows.id, windowId));
    expect(row[0]).toMatchObject({endedAt: expect.any(Date), endedReason: 'expired'});
    await expect(
      db()
        .select()
        .from(adminCommandResults)
        .where(
          and(
            eq(adminCommandResults.actorId, owner.userId),
            eq(adminCommandResults.command, 'auth.impersonation.window.continue'),
          ),
        ),
    ).resolves.toHaveLength(0);
  });

  test('records expiry metrics once across a repeated terminal Continue failure', async () => {
    const owner = await bootstrapOwner('window-expiry-metrics');
    const started = await startWindow({
      token: owner.token,
      key: 'window-expiry-metrics-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;
    await db()
      .update(impersonationWindows)
      .set({
        startedAt: new Date(Date.now() - 2_000),
        deadlineAt: new Date(Date.now() - 1_000),
      })
      .where(eq(impersonationWindows.id, windowId));

    const recordEnded = vi.spyOn(authMetrics, 'recordImpersonationWindowEnded');
    const recordDuration = vi.spyOn(authMetrics, 'recordImpersonationWindowDuration');
    const first = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/continue`,
      headers: authHeaders(owner.token, 'window-expiry-metrics-continue'),
      payload: {},
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/continue`,
      headers: authHeaders(owner.token, 'window-expiry-metrics-continue'),
      payload: {},
    });

    expect(first.statusCode).toBe(410);
    expect(replay.statusCode).toBe(410);
    expect(recordEnded).toHaveBeenCalledTimes(1);
    expect(recordEnded).toHaveBeenCalledWith('expired');
    expect(recordDuration).toHaveBeenCalledTimes(1);
    expect(recordDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  test('records expiry metrics for a capacity sweep committed by Start', async () => {
    const owner = await bootstrapOwner('window-capacity-metrics');
    const expiredStart = await startWindow({
      token: owner.token,
      key: 'window-capacity-metrics-expired',
    });
    const expiredWindowId = impersonationWindowStartResponseSchema.parse(
      expiredStart.json(),
    ).window_id;
    await db()
      .update(impersonationWindows)
      .set({
        startedAt: new Date(Date.now() - 2_000),
        deadlineAt: new Date(Date.now() - 1_000),
      })
      .where(eq(impersonationWindows.id, expiredWindowId));

    const recordEnded = vi.spyOn(authMetrics, 'recordImpersonationWindowEnded');
    const recordDuration = vi.spyOn(authMetrics, 'recordImpersonationWindowDuration');
    const replacement = await startWindow({
      token: owner.token,
      key: 'window-capacity-metrics-replacement',
    });

    expect(replacement.statusCode).toBe(200);
    expect(recordEnded).toHaveBeenCalledTimes(1);
    expect(recordEnded).toHaveBeenCalledWith('expired');
    expect(recordDuration).toHaveBeenCalledTimes(1);
    expect(recordDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  test('records expiry metrics when a capacity sweep precedes a failed Start', async () => {
    const owner = await bootstrapOwner('window-capacity-metrics-failure');
    const expiredStart = await startWindow({
      token: owner.token,
      key: 'window-capacity-metrics-failure-expired',
    });
    const expiredWindowId = impersonationWindowStartResponseSchema.parse(
      expiredStart.json(),
    ).window_id;
    await db()
      .update(impersonationWindows)
      .set({
        startedAt: new Date(Date.now() - 2_000),
        deadlineAt: new Date(Date.now() - 1_000),
      })
      .where(eq(impersonationWindows.id, expiredWindowId));

    getWorkspaceOperatingStateMock.mockResolvedValue({status: 'suspended'});
    const recordEnded = vi.spyOn(authMetrics, 'recordImpersonationWindowEnded');
    const recordDuration = vi.spyOn(authMetrics, 'recordImpersonationWindowDuration');
    const rejected = await startWindow({
      token: owner.token,
      key: 'window-capacity-metrics-failure-start',
    });

    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({code: 'impersonation-workspace-not-active'});
    expect(recordEnded).toHaveBeenCalledTimes(1);
    expect(recordEnded).toHaveBeenCalledWith('expired');
    expect(recordDuration).toHaveBeenCalledTimes(1);
    expect(recordDuration).toHaveBeenCalledWith(expect.any(Number));
    await expect(
      db()
        .select({endedReason: impersonationWindows.endedReason})
        .from(impersonationWindows)
        .where(eq(impersonationWindows.id, expiredWindowId)),
    ).resolves.toEqual([{endedReason: 'expired'}]);
  });

  test('audits and materializes a window in the final partial token second', async () => {
    const owner = await bootstrapOwner('window-final-second');
    const started = await startWindow({
      token: owner.token,
      key: 'window-final-second-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;
    const deadlineAt = new Date(Date.now() + 500);
    await db()
      .update(impersonationWindows)
      .set({deadlineAt})
      .where(eq(impersonationWindows.id, windowId));

    const continued = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/continue`,
      headers: authHeaders(owner.token, 'window-final-second-continue'),
      payload: {},
    });

    expect(continued.statusCode).toBe(410);
    expect(continued.json()).toEqual({code: 'impersonation-window-deadline-reached'});
    await expect(
      db()
        .select({
          endedAt: impersonationWindows.endedAt,
          endedReason: impersonationWindows.endedReason,
        })
        .from(impersonationWindows)
        .where(eq(impersonationWindows.id, windowId)),
    ).resolves.toEqual([{endedAt: deadlineAt, endedReason: 'expired'}]);
    const events = await actionEvents();
    expect(events.at(-1)?.payload).toMatchObject({
      command: 'auth.impersonation.window.continue',
      result: 'failed',
    });
  });

  test('does not mint after the workspace read crosses the window deadline', async () => {
    const owner = await bootstrapOwner('window-slow-memberships');
    const started = await startWindow({
      token: owner.token,
      key: 'window-slow-memberships-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;
    const deadlineAt = new Date(Date.now() + 2_000);
    await db()
      .update(impersonationWindows)
      .set({deadlineAt})
      .where(eq(impersonationWindows.id, windowId));

    const membershipsEntered = deferred();
    const releaseMemberships = deferred();
    getWorkspaceOperatingStateMock.mockImplementationOnce(async () => {
      membershipsEntered.resolve();
      await releaseMemberships.promise;
      return {status: 'active'};
    });
    const pendingContinue = app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/continue`,
      headers: authHeaders(owner.token, 'window-slow-memberships-continue'),
      payload: {},
    });

    await membershipsEntered.promise;
    const remainingMilliseconds = deadlineAt.getTime() - Date.now();
    if (remainingMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingMilliseconds + 50));
    }
    releaseMemberships.resolve();
    const continued = await pendingContinue;

    expect(continued.statusCode).toBe(410);
    expect(continued.json()).toEqual({code: 'impersonation-window-deadline-reached'});
    await expect(
      db()
        .select({
          endedAt: impersonationWindows.endedAt,
          endedReason: impersonationWindows.endedReason,
        })
        .from(impersonationWindows)
        .where(eq(impersonationWindows.id, windowId)),
    ).resolves.toEqual([{endedAt: deadlineAt, endedReason: 'expired'}]);
  });

  test('opens a window without a reason and stores the reason when one is sent', async () => {
    const owner = await bootstrapOwner('window-optional-reason');

    const withoutReason = await startWindow({
      token: owner.token,
      key: 'window-optional-reason-none',
      reason: null,
    });
    const withReason = await startWindow({
      token: owner.token,
      key: 'window-optional-reason-sent',
      reason: 'Legacy client reason',
    });

    expect(withoutReason.statusCode).toBe(200);
    expect(withReason.statusCode).toBe(200);
    const withoutReasonId = impersonationWindowStartResponseSchema.parse(
      withoutReason.json(),
    ).window_id;
    const withReasonId = impersonationWindowStartResponseSchema.parse(withReason.json()).window_id;
    const listed = await app.inject({
      method: 'GET',
      url: '/admin/auth/impersonation/windows?scope=owned',
      headers: {authorization: `Bearer ${owner.token}`},
    });
    const reasons = Object.fromEntries(
      impersonationWindowsResponseSchema
        .parse(listed.json())
        .windows.map((window) => [window.window_id, window.reason]),
    );
    expect(reasons).toEqual({
      [withoutReasonId]: null,
      [withReasonId]: 'Legacy client reason',
    });
    const events = await actionEvents();
    expect(events.map((event) => (event.payload as {reason: string | null}).reason)).toEqual([
      null,
      'Legacy client reason',
    ]);
  });

  test('keeps the reason of a window created before reasons became optional', async () => {
    const owner = await bootstrapOwner('window-legacy-reason');
    const target = await createVerifiedSession('window-legacy-reason-target');
    const window = await impersonationWindowFactory.create({
      actorId: owner.userId,
      targetUserId: target.userId,
      workspaceId: null,
      actorRoleAtStart: 'admin-owner',
      reason: 'Reason from before the change',
    });

    const exact = await app.inject({
      method: 'GET',
      url: `/admin/auth/impersonation/windows/${window.id}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(exact.statusCode).toBe(200);
    expect(impersonationWindowExactResponseSchema.parse(exact.json()).reason).toBe(
      'Reason from before the change',
    );
  });

  test('owner Stop works without a reason and audits the window reason', async () => {
    const owner = await bootstrapOwner('window-owner-stop-no-reason');
    const actor = await createVerifiedSession('window-owner-stop-no-reason-actor');
    const grant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'window-owner-stop-no-reason-grant'),
      payload: {user_id: actor.userId, role: 'admin-operator', reason: 'Window actor'},
    });
    expect(grant.statusCode).toBe(201);
    const started = await startWindow({
      token: actor.token,
      key: 'window-owner-stop-no-reason-start',
      reason: null,
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const stopped = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/stop`,
      headers: authHeaders(owner.token, 'window-owner-stop-no-reason'),
      payload: {},
    });

    expect(stopped.statusCode).toBe(200);
    expect(impersonationWindowStopResponseSchema.parse(stopped.json())).toMatchObject({
      window_id: windowId,
      state: 'stopped',
    });
    const events = await actionEvents();
    expect(events.at(-1)?.payload).toMatchObject({
      command: 'auth.impersonation.window.stop',
      authorizationBasis: 'current-role',
      actorRole: 'admin-owner',
      targetId: windowId,
      reason: null,
    });
  });

  test('owner Stop records a supplied reason with current-role audit context', async () => {
    const owner = await bootstrapOwner('window-owner-stop');
    const actor = await createVerifiedSession('window-owner-stop-actor');
    const grant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'window-owner-stop-grant'),
      payload: {user_id: actor.userId, role: 'admin-operator', reason: 'Window actor'},
    });
    expect(grant.statusCode).toBe(201);
    const started = await startWindow({
      token: actor.token,
      key: 'window-owner-stop-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const stopped = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/stop`,
      headers: authHeaders(owner.token, 'window-owner-stop'),
      payload: {reason: 'Owner confirmed the investigation is complete'},
    });
    expect(stopped.statusCode).toBe(200);
    const events = await actionEvents();
    expect(events.at(-1)?.payload).toMatchObject({
      command: 'auth.impersonation.window.stop',
      authorizationBasis: 'current-role',
      actorRole: 'admin-owner',
      requiredRole: 'admin-owner',
      targetType: 'impersonation-window',
      targetId: windowId,
      reason: 'Owner confirmed the investigation is complete',
    });
    expect(events.at(-1)?.payload).not.toHaveProperty('actorRoleAtStart');
    expect(JSON.stringify(events.at(-1)?.payload)).not.toContain('window-owner-stop');
  });

  test('audits only the first expired Stop materialization and stores terminal replays', async () => {
    const owner = await bootstrapOwner('window-expired-stop');
    const started = await startWindow({
      token: owner.token,
      key: 'window-expired-stop-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;
    await db()
      .update(impersonationWindows)
      .set({
        startedAt: new Date(Date.now() - 2_000),
        deadlineAt: new Date(Date.now() - 1_000),
      })
      .where(eq(impersonationWindows.id, windowId));

    const first = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/stop`,
      headers: authHeaders(owner.token, 'window-expired-stop-first'),
      payload: {},
    });
    const replay = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/stop`,
      headers: authHeaders(owner.token, 'window-expired-stop-replay'),
      payload: {},
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const events = await actionEvents();
    expect(events.map((event) => (event.payload as {command: string}).command)).toEqual([
      'auth.impersonation.window.start',
      'auth.impersonation.window.stop',
    ]);
    expect(events.at(-1)?.payload).toMatchObject({
      command: 'auth.impersonation.window.stop',
      authorizationBasis: 'impersonation-window-owner',
      actorRole: null,
      requiredRole: null,
      actorRoleAtStart: 'admin-owner',
      targetType: 'impersonation-window',
      targetId: windowId,
      reason: 'Support reproduction',
      result: 'succeeded',
    });
    await expect(
      db()
        .select()
        .from(adminCommandResults)
        .where(
          and(
            eq(adminCommandResults.actorId, owner.userId),
            eq(adminCommandResults.command, 'auth.impersonation.window.stop'),
          ),
        ),
    ).resolves.toHaveLength(2);
  });

  test('rejects reuse of a terminal Stop key on another window', async () => {
    const owner = await bootstrapOwner('window-terminal-stop-key');
    const firstStart = await startWindow({
      token: owner.token,
      key: 'window-terminal-stop-key-first-start',
    });
    const firstWindowId = impersonationWindowStartResponseSchema.parse(firstStart.json()).window_id;
    const firstStop = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${firstWindowId}/stop`,
      headers: authHeaders(owner.token, 'window-terminal-stop-key-first-stop'),
      payload: {},
    });
    expect(firstStop.statusCode).toBe(200);

    const terminalKey = 'window-terminal-stop-key-reused';
    const terminalReplay = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${firstWindowId}/stop`,
      headers: authHeaders(owner.token, terminalKey),
      payload: {},
    });
    expect(terminalReplay.statusCode).toBe(200);

    const secondStart = await startWindow({
      token: owner.token,
      key: 'window-terminal-stop-key-second-start',
    });
    const secondWindowId = impersonationWindowStartResponseSchema.parse(
      secondStart.json(),
    ).window_id;
    const reused = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${secondWindowId}/stop`,
      headers: authHeaders(owner.token, terminalKey),
      payload: {},
    });

    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toEqual({code: 'idempotency-key-reused'});
  });

  test('serializes a same-actor Start/Start race at the five-window limit', async () => {
    const owner = await bootstrapOwner('window-race-start-start');
    for (let index = 0; index < 4; index += 1) {
      const response = await startWindow({
        token: owner.token,
        key: `window-race-start-start-${index}`,
      });
      expect(response.statusCode).toBe(200);
    }

    const responses = await Promise.all([
      startWindow({
        token: owner.token,
        key: 'window-race-start-start-a',
      }),
      startWindow({
        token: owner.token,
        key: 'window-race-start-start-b',
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    await expect(
      db()
        .select()
        .from(impersonationWindows)
        .where(
          and(eq(impersonationWindows.actorId, owner.userId), isNull(impersonationWindows.endedAt)),
        ),
    ).resolves.toHaveLength(5);
  });

  test('serializes a same-actor Start/Continue race', async () => {
    const owner = await bootstrapOwner('window-race-start-continue');
    const started = await startWindow({
      token: owner.token,
      key: 'window-race-start-continue-existing',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const [newStart, continued] = await Promise.all([
      startWindow({
        token: owner.token,
        key: 'window-race-start-continue-start',
      }),
      app.inject({
        method: 'POST',
        url: `/admin/auth/impersonation/windows/${windowId}/continue`,
        headers: authHeaders(owner.token, 'window-race-start-continue-continue'),
        payload: {},
      }),
    ]);

    expect(newStart.statusCode).toBe(200);
    expect(continued.statusCode).toBe(200);
    await expect(
      db()
        .select()
        .from(impersonationWindows)
        .where(
          and(eq(impersonationWindows.actorId, owner.userId), isNull(impersonationWindows.endedAt)),
        ),
    ).resolves.toHaveLength(2);
  });

  test('serializes a same-actor Continue/Stop race', async () => {
    const owner = await bootstrapOwner('window-race-continue-stop');
    const started = await startWindow({
      token: owner.token,
      key: 'window-race-continue-stop-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const [continued, stopped] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/admin/auth/impersonation/windows/${windowId}/continue`,
        headers: authHeaders(owner.token, 'window-race-continue-stop-continue'),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/admin/auth/impersonation/windows/${windowId}/stop`,
        headers: authHeaders(owner.token, 'window-race-continue-stop-stop'),
        payload: {},
      }),
    ]);

    expect([200, 409, 410]).toContain(continued.statusCode);
    expect(stopped.statusCode).toBe(200);
    const exact = await app.inject({
      method: 'GET',
      url: `/admin/auth/impersonation/windows/${windowId}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });
    expect(exact.statusCode).toBe(200);
    expect(impersonationWindowExactResponseSchema.parse(exact.json())).toMatchObject({
      window_id: windowId,
      state: 'stopped',
      ended_reason: 'stopped',
    });
  });

  test('serializes a same-actor Stop/Stop race with one terminal transition', async () => {
    const owner = await bootstrapOwner('window-race-stop-stop');
    const started = await startWindow({
      token: owner.token,
      key: 'window-race-stop-stop-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/admin/auth/impersonation/windows/${windowId}/stop`,
        headers: authHeaders(owner.token, 'window-race-stop-stop-a'),
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/admin/auth/impersonation/windows/${windowId}/stop`,
        headers: authHeaders(owner.token, 'window-race-stop-stop-b'),
        payload: {},
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses.map((response) => response.json().state)).toEqual(['stopped', 'stopped']);
    const events = await actionEvents();
    expect(
      events.filter((event) => (event.payload as {command: string}).command.endsWith('.stop')),
    ).toHaveLength(1);
    await expect(
      db()
        .select()
        .from(adminCommandResults)
        .where(
          and(
            eq(adminCommandResults.actorId, owner.userId),
            eq(adminCommandResults.command, 'auth.impersonation.window.stop'),
          ),
        ),
    ).resolves.toHaveLength(2);
  });

  test('stores only token fingerprints for window command results', async () => {
    const owner = await bootstrapOwner('window-redaction-result');
    const started = await startWindow({
      token: owner.token,
      key: 'window-redaction-result-start',
    });
    const body = impersonationWindowStartResponseSchema.parse(started.json());
    const rows = await db()
      .select()
      .from(adminCommandResults)
      .where(eq(adminCommandResults.command, 'auth.impersonation.window.start'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toMatchObject({
      impersonationWindow: {
        windowId: body.window_id,
        workspaceId: body.workspace_id,
        tokenFingerprints: [hashOpaqueToken(body.token)],
      },
    });
    expect(JSON.stringify(rows[0]?.result)).not.toContain(body.token);
    expect(JSON.stringify(rows[0]?.result)).not.toContain('window-redaction-result-start');
  });
});
