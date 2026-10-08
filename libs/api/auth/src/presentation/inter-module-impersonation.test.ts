import {authInterModuleContract} from '@shipfox/api-auth-dto/inter-module';
import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {eq, sql} from 'drizzle-orm';
import {createAdminGrant, revokeAdminGrant} from '#db/admin-grants.js';
import {db} from '#db/db.js';
import {impersonationWindows} from '#db/schema/impersonation-windows.js';
import {authOutbox} from '#db/schema/outbox.js';
import {impersonationWindowFactory} from '#test/index.js';
import {
  createAuthTestApp,
  createVerifiedSession,
  resetCapturedMail,
  setImpersonationEnabled,
  testWorkspaces,
} from '#test/routes.js';
import {createAuthInterModulePresentation} from './inter-module.js';

function createClient() {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(authInterModuleContract);
  transport.register(createAuthInterModulePresentation(testWorkspaces));
  transport.seal();
  return client;
}

async function knownErrorCode(
  method: (typeof authInterModuleContract.methods)[
    | 'startImpersonationWindow'
    | 'stopImpersonationWindow'
    | 'findOpenImpersonationWindow'],
  promise: Promise<unknown>,
): Promise<string | undefined> {
  const error = await promise.catch((caught: unknown) => caught);
  return isInterModuleKnownError(method, error) ? error.code : undefined;
}

describe('Auth inter-module impersonation windows', () => {
  let app: Awaited<ReturnType<typeof createAuthTestApp>>;
  const client = createClient();

  beforeAll(async () => {
    app = await createAuthTestApp();
  });

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE auth_impersonation_windows, auth_admin_command_results, auth_admin_grants, auth_outbox, auth_rate_limits CASCADE`,
    );
    resetCapturedMail();
    setImpersonationEnabled(true);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOperator(prefix: string) {
    const session = await createVerifiedSession(prefix);
    const grant = await createAdminGrant({userId: session.userId, role: 'admin-operator'});
    return {...session, grantId: grant.id};
  }

  function mutation(params: {actorId: string; workspaceId: string; key?: string}) {
    return {
      actorId: params.actorId,
      workspaceId: params.workspaceId,
      idempotencyKey: params.key ?? crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
    };
  }

  async function windowAuditEvents(command: string) {
    const rows = await db().select().from(authOutbox).orderBy(authOutbox.createdAt);
    return rows.filter(
      (row) =>
        row.eventType === ADMINISTRATION_ACTION_PERFORMED &&
        (row.payload as {command?: string}).command === command,
    );
  }

  test('starts a window that the ledger shows, audited like a browser start, without a token', async () => {
    const operator = await createOperator('contract-start');
    const workspaceId = crypto.randomUUID();

    const started = await client.startImpersonationWindow(
      mutation({actorId: operator.userId, workspaceId}),
    );

    expect(Object.keys(started).sort()).toEqual([
      'deadlineAt',
      'startedAt',
      'windowId',
      'workspaceId',
    ]);
    expect(started.workspaceId).toBe(workspaceId);
    const listed = await app.inject({
      method: 'GET',
      url: '/admin/auth/impersonation/windows?scope=owned',
      headers: {authorization: `Bearer ${operator.token}`},
    });
    expect(listed.json().windows).toEqual([
      expect.objectContaining({
        window_id: started.windowId,
        workspace_id: workspaceId,
        deadline_at: started.deadlineAt,
      }),
    ]);
    const events = await windowAuditEvents('auth.impersonation.window.start');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual(
      expect.objectContaining({
        actorId: operator.userId,
        targetType: 'workspace',
        targetId: workspaceId,
        result: 'succeeded',
      }),
    );
  });

  test('returns the open window when the actor already has one on the workspace', async () => {
    const operator = await createOperator('contract-start-twice');
    const workspaceId = crypto.randomUUID();

    const first = await client.startImpersonationWindow(
      mutation({actorId: operator.userId, workspaceId}),
    );
    const second = await client.startImpersonationWindow(
      mutation({actorId: operator.userId, workspaceId}),
    );

    expect(second).toEqual(first);
    expect(await db().select().from(impersonationWindows)).toHaveLength(1);
  });

  test('finds a window started in the browser, and a browser-visible window started here', async () => {
    const operator = await createOperator('contract-find');
    const workspaceId = crypto.randomUUID();
    const browserStart = await app.inject({
      method: 'POST',
      url: '/admin/auth/impersonation/windows',
      headers: {authorization: `Bearer ${operator.token}`, 'idempotency-key': 'browser-start'},
      payload: {workspace_id: workspaceId},
    });
    expect(browserStart.statusCode).toBe(200);

    const found = await client.findOpenImpersonationWindow({
      actorId: operator.userId,
      workspaceId,
    });
    const started = await client.startImpersonationWindow(
      mutation({actorId: operator.userId, workspaceId}),
    );

    expect(found.windowId).toBe(browserStart.json().window_id);
    expect(found.deadlineAt).toBe(browserStart.json().window_deadline);
    expect(started.windowId).toBe(found.windowId);
  });

  test('stops the open window on the workspace and then fails the lookup', async () => {
    const operator = await createOperator('contract-stop');
    const workspaceId = crypto.randomUUID();
    const started = await client.startImpersonationWindow(
      mutation({actorId: operator.userId, workspaceId}),
    );

    const stopped = await client.stopImpersonationWindow(
      mutation({actorId: operator.userId, workspaceId}),
    );

    expect(stopped.windowId).toBe(started.windowId);
    expect(
      await knownErrorCode(
        authInterModuleContract.methods.findOpenImpersonationWindow,
        client.findOpenImpersonationWindow({actorId: operator.userId, workspaceId}),
      ),
    ).toBe('impersonation-window-closed');
    expect(
      await knownErrorCode(
        authInterModuleContract.methods.stopImpersonationWindow,
        client.stopImpersonationWindow(mutation({actorId: operator.userId, workspaceId})),
      ),
    ).toBe('impersonation-window-closed');
    expect(await windowAuditEvents('auth.impersonation.window.stop')).toHaveLength(1);
  });

  test('fails the lookup after the deadline', async () => {
    const operator = await createOperator('contract-deadline');
    const workspaceId = crypto.randomUUID();
    await impersonationWindowFactory.create({
      actorId: operator.userId,
      workspaceId,
      startedAt: new Date(Date.now() - 2 * 60 * 1000),
      deadlineAt: new Date(Date.now() - 60 * 1000),
    });

    expect(
      await knownErrorCode(
        authInterModuleContract.methods.findOpenImpersonationWindow,
        client.findOpenImpersonationWindow({actorId: operator.userId, workspaceId}),
      ),
    ).toBe('impersonation-window-closed');
  });

  test('refuses every method once the actor role is revoked', async () => {
    const operator = await createOperator('contract-revoked');
    const workspaceId = crypto.randomUUID();
    await client.startImpersonationWindow(mutation({actorId: operator.userId, workspaceId}));
    await revokeAdminGrant({grantId: operator.grantId});

    expect(
      await knownErrorCode(
        authInterModuleContract.methods.findOpenImpersonationWindow,
        client.findOpenImpersonationWindow({actorId: operator.userId, workspaceId}),
      ),
    ).toBe('admin-role-required');
    expect(
      await knownErrorCode(
        authInterModuleContract.methods.startImpersonationWindow,
        client.startImpersonationWindow(mutation({actorId: operator.userId, workspaceId})),
      ),
    ).toBe('admin-role-required');
    expect(
      await knownErrorCode(
        authInterModuleContract.methods.stopImpersonationWindow,
        client.stopImpersonationWindow(mutation({actorId: operator.userId, workspaceId})),
      ),
    ).toBe('admin-role-required');
  });

  test('refuses an observer and a user with no administrator role', async () => {
    const observer = await createVerifiedSession('contract-observer');
    await createAdminGrant({userId: observer.userId, role: 'admin-observer'});
    const member = await createVerifiedSession('contract-member');
    const workspaceId = crypto.randomUUID();

    for (const actorId of [observer.userId, member.userId]) {
      expect(
        await knownErrorCode(
          authInterModuleContract.methods.startImpersonationWindow,
          client.startImpersonationWindow(mutation({actorId, workspaceId})),
        ),
      ).toBe('admin-role-required');
    }
  });

  test('refuses to start while impersonation is disabled', async () => {
    const operator = await createOperator('contract-disabled');
    setImpersonationEnabled(false);

    expect(
      await knownErrorCode(
        authInterModuleContract.methods.startImpersonationWindow,
        client.startImpersonationWindow(
          mutation({actorId: operator.userId, workspaceId: crypto.randomUUID()}),
        ),
      ),
    ).toBe('impersonation-disabled');
  });

  test('rate limits start by actor with the impersonate bucket', async () => {
    const operator = await createOperator('contract-rate-limit');
    const workspaceId = crypto.randomUUID();
    await client.startImpersonationWindow(mutation({actorId: operator.userId, workspaceId}));
    for (let call = 1; call < 20; call++) {
      await client.startImpersonationWindow(mutation({actorId: operator.userId, workspaceId}));
    }

    expect(
      await knownErrorCode(
        authInterModuleContract.methods.startImpersonationWindow,
        client.startImpersonationWindow(mutation({actorId: operator.userId, workspaceId})),
      ),
    ).toBe('rate-limited');
  });

  test('keeps the window row untouched by a lookup', async () => {
    const operator = await createOperator('contract-readonly');
    const workspaceId = crypto.randomUUID();
    const started = await client.startImpersonationWindow(
      mutation({actorId: operator.userId, workspaceId}),
    );

    await client.findOpenImpersonationWindow({actorId: operator.userId, workspaceId});

    const rows = await db()
      .select()
      .from(impersonationWindows)
      .where(eq(impersonationWindows.id, started.windowId));
    expect(rows[0]?.endedAt).toBeNull();
  });
});
