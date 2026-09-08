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
import {and, eq, sql} from 'drizzle-orm';
import {verifyUserToken} from '#core/jwt.js';
import {db} from '#db/db.js';
import {adminCommandResults} from '#db/schema/admin-command-results.js';
import {impersonationWindows} from '#db/schema/impersonation-windows.js';
import {authOutbox} from '#db/schema/outbox.js';
import * as authMetrics from '#metrics/index.js';
import {
  createAuthTestApp,
  createVerifiedSession,
  listMembershipsByUserMock,
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
    targetUserId: string;
    key: string;
    reason?: string;
    requiredWorkspaceId?: string;
    requestId?: string;
  }) {
    return await app.inject({
      method: 'POST',
      url: '/admin/auth/impersonation/windows',
      headers: authHeaders(params.token, params.key, params.requestId),
      payload: {
        target_user_id: params.targetUserId,
        reason: params.reason ?? 'Support reproduction',
        ...(params.requiredWorkspaceId ? {required_workspace_id: params.requiredWorkspaceId} : {}),
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
    const target = await createVerifiedSession('window-start-metrics-success-target');
    const recordOutcome = vi.spyOn(authMetrics, 'recordImpersonationOutcome');
    const recordWindowStartOutcome = vi.spyOn(authMetrics, 'recordImpersonationWindowStartOutcome');

    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
    const target = await createVerifiedSession('window-start-metrics-denied-target');
    setImpersonationEnabled(false);
    const recordOutcome = vi.spyOn(authMetrics, 'recordImpersonationOutcome');
    const recordWindowStartOutcome = vi.spyOn(authMetrics, 'recordImpersonationWindowStartOutcome');

    const rejected = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
    const target = await createVerifiedSession('window-protocol-target');

    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
        target: expect.objectContaining({id: target.userId}),
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
    expect(claims.sub).toBe(target.userId);

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

  test('keeps reads and owned Stop available when minting is disabled', async () => {
    const owner = await bootstrapOwner('window-disabled');
    const target = await createVerifiedSession('window-disabled-target');
    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
    const target = await createVerifiedSession('window-redaction-target');
    const other = await createVerifiedSession('window-redaction-other');
    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
    const target = await createVerifiedSession('window-limit-target');

    for (let index = 0; index < 5; index += 1) {
      const response = await startWindow({
        token: owner.token,
        targetUserId: target.userId,
        key: `window-limit-${index}`,
      });
      expect(response.statusCode).toBe(200);
    }
    const sixth = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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

  test('checks required workspace membership against the claims snapshot', async () => {
    const owner = await bootstrapOwner('window-workspace');
    const target = await createVerifiedSession('window-workspace-target');
    const workspaceId = crypto.randomUUID();
    listMembershipsByUserMock.mockResolvedValue({
      memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
    });

    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
      key: 'window-workspace-start',
      requiredWorkspaceId: workspaceId,
    });
    expect(started.statusCode).toBe(200);
    const body = impersonationWindowStartResponseSchema.parse(started.json());
    const claims = await verifyUserToken({token: body.token, secret: userAccessTokenKey()});
    expect(claims.memberships).toEqual([{workspaceId, role: 'admin', workspaceStatus: 'active'}]);

    listMembershipsByUserMock.mockResolvedValue({
      memberships: [{workspaceId, role: 'admin', workspaceStatus: 'suspended'}],
    });
    const rejected = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
      key: 'window-workspace-suspended',
      requiredWorkspaceId: workspaceId,
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toEqual({code: 'impersonation-target-not-workspace-member'});
  });

  test('commits expiry before Continue returns deadline reached', async () => {
    const owner = await bootstrapOwner('window-expiry');
    const target = await createVerifiedSession('window-expiry-target');
    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
    const target = await createVerifiedSession('window-expiry-metrics-target');
    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
    const target = await createVerifiedSession('window-capacity-metrics-target');
    const expiredStart = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
      targetUserId: target.userId,
      key: 'window-capacity-metrics-replacement',
    });

    expect(replacement.statusCode).toBe(200);
    expect(recordEnded).toHaveBeenCalledTimes(1);
    expect(recordEnded).toHaveBeenCalledWith('expired');
    expect(recordDuration).toHaveBeenCalledTimes(1);
    expect(recordDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  test('owner Stop requires a fresh reason and emits current-role audit context', async () => {
    const owner = await bootstrapOwner('window-owner-stop');
    const actor = await createVerifiedSession('window-owner-stop-actor');
    const target = await createVerifiedSession('window-owner-stop-target');
    const grant = await app.inject({
      method: 'POST',
      url: '/admin/auth/admin-grants',
      headers: authHeaders(owner.token, 'window-owner-stop-grant'),
      payload: {user_id: actor.userId, role: 'admin-operator', reason: 'Window actor'},
    });
    expect(grant.statusCode).toBe(201);
    const started = await startWindow({
      token: actor.token,
      targetUserId: target.userId,
      key: 'window-owner-stop-start',
    });
    const windowId = impersonationWindowStartResponseSchema.parse(started.json()).window_id;

    const missingReason = await app.inject({
      method: 'POST',
      url: `/admin/auth/impersonation/windows/${windowId}/stop`,
      headers: authHeaders(owner.token, 'window-owner-stop-missing-reason'),
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);
    expect(missingReason.json()).toEqual({code: 'impersonation-stop-reason-required'});

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
    const target = await createVerifiedSession('window-expired-stop-target');
    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
    const target = await createVerifiedSession('window-terminal-stop-key-target');
    const firstStart = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
      targetUserId: target.userId,
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

  test('stores only token fingerprints for window command results', async () => {
    const owner = await bootstrapOwner('window-redaction-result');
    const target = await createVerifiedSession('window-redaction-result-target');
    const started = await startWindow({
      token: owner.token,
      targetUserId: target.userId,
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
        targetUserId: target.userId,
        tokenFingerprints: [hashOpaqueToken(body.token)],
      },
    });
    expect(JSON.stringify(rows[0]?.result)).not.toContain(body.token);
    expect(JSON.stringify(rows[0]?.result)).not.toContain('window-redaction-result-start');
  });
});
