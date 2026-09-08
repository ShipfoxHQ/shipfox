import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {
  type AdministratorUserSummaryInterModule,
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {ADMINISTRATION_ACTION_PERFORMED} from '@shipfox/api-common-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {db} from '#db/db.js';
import {createInvitation, listOpenInvitationsByWorkspace} from '#db/invitations.js';
import {createMembership, listMembershipsByWorkspace} from '#db/memberships.js';
import {workspacesAdminCommandResults} from '#db/schema/admin-command-results.js';
import {workspacesOutbox} from '#db/schema/outbox.js';
import {createWorkspace, getWorkspaceById, updateWorkspace} from '#db/workspaces.js';
import {createAdminWorkspacesRoutes} from './admin-workspaces.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function administratorUserSummary(params: {
  id: string;
  email?: string;
  name?: string | null;
}): AdministratorUserSummaryInterModule {
  const timestamp = '2026-09-05T12:00:00.000Z';
  return {
    id: params.id,
    email: params.email ?? `member-${params.id}@example.com`,
    name: params.name ?? 'Workspace member',
    status: 'active',
    emailVerifiedAt: timestamp,
    createdAt: timestamp,
    adminRole: null,
  };
}

function adminHeaders(idempotencyKey: string) {
  return {
    authorization: 'Bearer user',
    'idempotency-key': idempotencyKey,
  };
}

let authenticatedImpersonatorId: string | undefined;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId: USER_ID,
        email: 'admin@example.com',
        memberships: [],
        impersonatorId: authenticatedImpersonatorId,
      }),
    );
    return Promise.resolve();
  },
};

describe('GET /admin/workspaces', () => {
  let app: FastifyInstance;
  let auth: AuthInterModuleClient;
  let projects: ProjectsModuleClient;
  let runners: RunnersInterModuleClient;

  beforeEach(async () => {
    await closeApp();
    authenticatedImpersonatorId = undefined;
    await db().execute(
      sql`TRUNCATE workspaces_admin_command_results, workspaces_outbox, workspaces_rate_limits, workspaces_workspaces CASCADE`,
    );
    auth = {
      requireAdminRole: vi
        .fn()
        .mockImplementation(({minimumRole}) => Promise.resolve({role: minimumRole})),
      listImpersonationEligibleUserSummaries: vi.fn().mockResolvedValue({
        users: [],
        nextCursor: null,
      }),
    } as unknown as AuthInterModuleClient;
    projects = {
      getWorkspaceProjectCounts: vi.fn().mockResolvedValue({counts: []}),
    } as unknown as ProjectsModuleClient;
    runners = {
      getWorkspaceJobCounts: vi.fn().mockResolvedValue({counts: []}),
    } as unknown as RunnersInterModuleClient;
    app = await createApp({
      auth: [fakeUserAuth],
      routes: [createAdminWorkspacesRoutes({auth, projects, runners})],
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('returns a bounded safe workspace summary for an observer', async () => {
    const workspace = await createWorkspace({name: `Admin lookup ${crypto.randomUUID()}`});
    await createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id});
    vi.mocked(projects.getWorkspaceProjectCounts).mockResolvedValue({
      counts: [{workspaceId: workspace.id, count: 3}],
    });
    vi.mocked(runners.getWorkspaceJobCounts).mockResolvedValue({
      counts: [{workspaceId: workspace.id, queued: 2, running: 1}],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces?workspace_id=${workspace.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaces: [
        {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          status: 'active',
          member_summary: {count: 1},
          project_summary: {state: 'available', count: 3},
          job_counts: {state: 'available', queued: 2, running: 1},
        },
      ],
      next_cursor: null,
    });
    expect(response.json().workspaces[0]).not.toHaveProperty('settings');
    expect(response.json().workspaces[0]).not.toHaveProperty('administrator');
    expect(auth.requireAdminRole).toHaveBeenCalledWith({
      userId: USER_ID,
      minimumRole: 'admin-observer',
    });
  });

  test('resolves an exact workspace slug without paginating the collection', async () => {
    const slug = `exact-${crypto.randomUUID().slice(0, 8)}`;
    const workspace = await createWorkspace({
      name: `Exact ${crypto.randomUUID()}`,
      slug,
    });
    await createWorkspace({name: `Other ${crypto.randomUUID()}`});

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces?workspace_slug=${slug}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaces: [expect.objectContaining({id: workspace.id, slug})],
      next_cursor: null,
    });
  });

  test('lists only eligible workspace members through one bounded Auth call', async () => {
    const workspace = await createWorkspace({name: `Targets ${crypto.randomUUID()}`});
    const first = await createMembership({
      userId: crypto.randomUUID(),
      userEmail: `first-${crypto.randomUUID()}@example.com`,
      workspaceId: workspace.id,
    });
    const second = await createMembership({
      userId: crypto.randomUUID(),
      userEmail: `second-${crypto.randomUUID()}@example.com`,
      workspaceId: workspace.id,
    });
    vi.mocked(auth.listImpersonationEligibleUserSummaries).mockImplementation(
      async ({userIds}) => ({
        users: (userIds ?? []).map((id, index) =>
          administratorUserSummary({id, name: `Eligible ${index}`}),
        ),
        nextCursor: null,
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces/${workspace.id}/members`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      workspace_name: workspace.name,
      workspace_status: 'active',
      members: expect.arrayContaining([
        expect.objectContaining({id: first.userId, status: 'active'}),
        expect.objectContaining({id: second.userId, status: 'active'}),
      ]),
      next_cursor: null,
    });
    expect(auth.requireAdminRole).toHaveBeenCalledWith({
      userId: USER_ID,
      minimumRole: 'admin-operator',
    });
    expect(auth.listImpersonationEligibleUserSummaries).toHaveBeenCalledTimes(1);
    expect(auth.listImpersonationEligibleUserSummaries).toHaveBeenCalledWith({
      userIds: expect.arrayContaining([first.userId, second.userId]),
      limit: 200,
    });
  });

  test('uses Auth candidate order for exact email search and preserves its cursor', async () => {
    const workspace = await createWorkspace({name: `Search targets ${crypto.randomUUID()}`});
    const first = await createMembership({
      userId: crypto.randomUUID(),
      userEmail: `first-${crypto.randomUUID()}@example.com`,
      workspaceId: workspace.id,
    });
    const second = await createMembership({
      userId: crypto.randomUUID(),
      userEmail: `exact-${crypto.randomUUID()}@example.com`,
      workspaceId: workspace.id,
    });
    vi.mocked(auth.listImpersonationEligibleUserSummaries).mockResolvedValueOnce({
      users: [administratorUserSummary({id: second.userId, email: second.userEmail})],
      nextCursor: 'auth-next-cursor',
    });

    const firstResponse = await app.inject({
      method: 'GET',
      url: `/admin/workspaces/${workspace.id}/members?search=${encodeURIComponent(second.userEmail)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.json()).toMatchObject({
      members: [expect.objectContaining({id: second.userId, email: second.userEmail})],
      next_cursor: expect.any(String),
    });
    expect(firstResponse.json().members.map((member: {id: string}) => member.id)).not.toContain(
      first.userId,
    );

    const nextCursor = firstResponse.json().next_cursor;
    vi.mocked(auth.listImpersonationEligibleUserSummaries).mockResolvedValueOnce({
      users: [],
      nextCursor: null,
    });
    const secondResponse = await app.inject({
      method: 'GET',
      url: `/admin/workspaces/${workspace.id}/members?search=${encodeURIComponent(second.userEmail)}&cursor=${encodeURIComponent(nextCursor)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.json()).toMatchObject({members: [], next_cursor: null});
    expect(auth.listImpersonationEligibleUserSummaries).toHaveBeenLastCalledWith({
      search: second.userEmail,
      cursor: 'auth-next-cursor',
      limit: 200,
    });
  });

  test.each([
    'suspended',
    'deleted',
  ] as const)('returns a %s workspace summary without members', async (status) => {
    const workspace = await createWorkspace({name: `${status} targets ${crypto.randomUUID()}`});
    await updateWorkspace({id: workspace.id, status});

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces/${workspace.id}/members`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspace_id: workspace.id,
      workspace_status: status,
      members: [],
      next_cursor: null,
    });
    expect(auth.listImpersonationEligibleUserSummaries).not.toHaveBeenCalled();
  });

  test('validates an exact recent target through membership and Auth eligibility', async () => {
    const workspace = await createWorkspace({name: `Exact target ${crypto.randomUUID()}`});
    const membership = await createMembership({
      userId: crypto.randomUUID(),
      userEmail: `exact-target-${crypto.randomUUID()}@example.com`,
      workspaceId: workspace.id,
    });
    vi.mocked(auth.listImpersonationEligibleUserSummaries).mockResolvedValue({
      users: [administratorUserSummary({id: membership.userId, email: membership.userEmail})],
      nextCursor: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces/${workspace.id}/members?user_id=${membership.userId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      members: [expect.objectContaining({id: membership.userId})],
      next_cursor: null,
    });
    expect(auth.listImpersonationEligibleUserSummaries).toHaveBeenCalledWith({
      userIds: [membership.userId],
      limit: 1,
    });
  });

  test('keeps member resources UUID-addressed and requires an operator', async () => {
    const slugResponse = await app.inject({
      method: 'GET',
      url: '/admin/workspaces/acme/members',
      headers: {authorization: 'Bearer user'},
    });
    expect(slugResponse.statusCode).toBe(400);

    vi.mocked(auth.requireAdminRole).mockRejectedValue(
      createInterModuleKnownError(
        authInterModuleContract.methods.requireAdminRole,
        'admin-role-required',
        {requiredRole: 'admin-operator'},
      ),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces/${crypto.randomUUID()}/members`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({code: 'forbidden'});
    expect(auth.listImpersonationEligibleUserSummaries).not.toHaveBeenCalled();
  });

  test('suspends a workspace without deleting its data and writes one redacted event', async () => {
    const workspace = await createWorkspace({name: `Suspend ${crypto.randomUUID()}`});
    await updateWorkspace({id: workspace.id, settings: {retained: true}});
    await createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id});
    await createInvitation({
      workspaceId: workspace.id,
      email: `pending-${crypto.randomUUID()}@example.com`,
      hashedToken: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      invitedByUserId: USER_ID,
      skipEmail: true,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('suspend-workspace'),
      payload: {reason: 'Requested by support'},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({workspace_id: workspace.id, status: 'suspended'});
    expect(body.correlation_id).toEqual(expect.any(String));
    await expect(getWorkspaceById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      status: 'suspended',
      settings: {retained: true},
    });
    await expect(listMembershipsByWorkspace({workspaceId: workspace.id})).resolves.toHaveLength(1);
    await expect(listOpenInvitationsByWorkspace({workspaceId: workspace.id})).resolves.toHaveLength(
      1,
    );

    const events = await db()
      .select()
      .from(workspacesOutbox)
      .where(eq(workspacesOutbox.eventType, ADMINISTRATION_ACTION_PERFORMED));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: ADMINISTRATION_ACTION_PERFORMED,
      payload: {
        actorId: USER_ID,
        actorRole: 'admin-operator',
        requiredRole: 'admin-operator',
        command: 'workspace.suspend',
        targetType: 'workspace',
        targetId: workspace.id,
        reason: 'Requested by support',
        result: 'succeeded',
        correlationId: body.correlation_id,
      },
    });
    expect(events[0]?.payload).not.toHaveProperty('idempotencyKey');
    await expect(
      db()
        .select()
        .from(workspacesAdminCommandResults)
        .where(eq(workspacesAdminCommandResults.actorId, USER_ID)),
    ).resolves.toHaveLength(1);
  });

  test('returns the committed suspension result on an idempotent retry', async () => {
    const workspace = await createWorkspace({name: `Retry ${crypto.randomUUID()}`});
    const first = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('retry-workspace-suspend'),
      payload: {reason: 'Retry test'},
    });
    const retry = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('retry-workspace-suspend'),
      payload: {reason: 'Retry test'},
    });

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    await expect(
      db()
        .select()
        .from(workspacesAdminCommandResults)
        .where(eq(workspacesAdminCommandResults.actorId, USER_ID)),
    ).resolves.toHaveLength(1);
    await expect(
      db()
        .select()
        .from(workspacesOutbox)
        .where(eq(workspacesOutbox.eventType, ADMINISTRATION_ACTION_PERFORMED)),
    ).resolves.toHaveLength(1);
  });

  test('reactivates a suspended workspace while preserving its membership', async () => {
    const workspace = await createWorkspace({name: `Reactivate ${crypto.randomUUID()}`});
    await createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id});

    const suspended = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('reactivation-suspend'),
      payload: {reason: 'Temporary suspension'},
    });
    const reactivated = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/reactivate`,
      headers: adminHeaders('reactivation-reactivate'),
      payload: {reason: 'Issue resolved'},
    });

    expect(suspended.statusCode).toBe(200);
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({workspace_id: workspace.id, status: 'active'});
    await expect(getWorkspaceById(workspace.id)).resolves.toMatchObject({status: 'active'});
    await expect(listMembershipsByWorkspace({workspaceId: workspace.id})).resolves.toHaveLength(1);
    await expect(
      db()
        .select()
        .from(workspacesOutbox)
        .where(eq(workspacesOutbox.eventType, ADMINISTRATION_ACTION_PERFORMED)),
    ).resolves.toHaveLength(2);
  });

  test('rejects reusing an idempotency key for another workspace command', async () => {
    const workspace = await createWorkspace({name: `Reuse ${crypto.randomUUID()}`});
    const suspended = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('reused-workspace-key'),
      payload: {reason: 'Reuse test'},
    });
    const reused = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/reactivate`,
      headers: adminHeaders('reused-workspace-key'),
      payload: {reason: 'Reuse test'},
    });

    expect(suspended.statusCode).toBe(200);
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({code: 'idempotency-key-reused'});
    await expect(getWorkspaceById(workspace.id)).resolves.toMatchObject({status: 'suspended'});
  });

  test.each([
    ['missing', undefined],
    ['blank', '   '],
    ['oversized', 'x'.repeat(257)],
  ])('requires an idempotency key when it is %s', async (_case, idempotencyKey) => {
    const workspace = await createWorkspace({name: `Key ${crypto.randomUUID()}`});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: {
        authorization: 'Bearer user',
        ...(idempotencyKey === undefined ? {} : {'idempotency-key': idempotencyKey}),
      },
      payload: {reason: 'Missing key test'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('idempotency-key-required');
  });

  test.each([
    ['empty', ''],
    ['oversized', 'x'.repeat(513)],
    ['control character', 'Reason\nwith control'],
    ['format character', 'Reason\u202ewith format character'],
  ])('rejects a %s administration reason', async (_case, reason) => {
    const workspace = await createWorkspace({name: `Reason ${crypto.randomUUID()}`});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders(`invalid-reason-${crypto.randomUUID()}`),
      payload: {reason},
    });

    expect(response.statusCode).toBe(400);
  });

  test('returns not found for an unknown workspace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${crypto.randomUUID()}/suspend`,
      headers: adminHeaders('unknown-workspace'),
      payload: {reason: 'Unknown workspace test'},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('workspace-not-found');
  });

  test('rejects suspending an already suspended workspace with a fresh key', async () => {
    const workspace = await createWorkspace({name: `Already suspended ${crypto.randomUUID()}`});
    const first = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('already-suspended-first'),
      payload: {reason: 'First suspension'},
    });
    const second = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('already-suspended-second'),
      payload: {reason: 'Second suspension'},
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('workspace-already-suspended');
  });

  test('rejects reactivating an active workspace', async () => {
    const workspace = await createWorkspace({name: `Already active ${crypto.randomUUID()}`});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/reactivate`,
      headers: adminHeaders('already-active-reactivate'),
      payload: {reason: 'Already active test'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('workspace-not-suspended');
  });

  test('rejects mutating a deleted workspace', async () => {
    const workspace = await createWorkspace({name: `Deleted ${crypto.randomUUID()}`});
    await updateWorkspace({id: workspace.id, status: 'deleted'});
    const response = await app.inject({
      method: 'POST',
      url: `/admin/workspaces/${workspace.id}/suspend`,
      headers: adminHeaders('deleted-workspace'),
      payload: {reason: 'Deleted workspace test'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('workspace-deleted');
  });

  test('does not expose a versioned administration namespace', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/v1/workspaces/00000000-0000-4000-8000-000000000001/suspend',
      headers: adminHeaders('versioned-route'),
      payload: {reason: 'Should not route'},
    });

    expect(response.statusCode).toBe(404);
  });

  test('returns explicit unknown job counts when the supporting lookup fails', async () => {
    const workspace = await createWorkspace({name: `Unknown jobs ${crypto.randomUUID()}`});
    vi.mocked(projects.getWorkspaceProjectCounts).mockResolvedValue({
      counts: [{workspaceId: workspace.id, count: 0}],
    });
    vi.mocked(runners.getWorkspaceJobCounts).mockRejectedValue(new Error('runner service down'));

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces?workspace_id=${workspace.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().workspaces[0]).toMatchObject({
      project_summary: {state: 'available', count: 0},
      job_counts: {state: 'unknown'},
    });
  });

  test('keeps known supporting counts when a response omits another workspace', async () => {
    const prefix = `Partial counts ${crypto.randomUUID()}`;
    const firstWorkspace = await createWorkspace({name: `${prefix} Alpha`});
    const secondWorkspace = await createWorkspace({name: `${prefix} Beta`});
    vi.mocked(projects.getWorkspaceProjectCounts).mockResolvedValue({
      counts: [{workspaceId: firstWorkspace.id, count: 2}],
    });
    vi.mocked(runners.getWorkspaceJobCounts).mockResolvedValue({
      counts: [{workspaceId: firstWorkspace.id, queued: 1, running: 2}],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/admin/workspaces?search=${encodeURIComponent(prefix)}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().workspaces).toEqual([
      expect.objectContaining({
        id: firstWorkspace.id,
        project_summary: {state: 'available', count: 2},
        job_counts: {state: 'available', queued: 1, running: 2},
      }),
      expect.objectContaining({
        id: secondWorkspace.id,
        project_summary: {state: 'unknown'},
        job_counts: {state: 'unknown'},
      }),
    ]);
  });

  test('rejects an impersonated session before consulting the administrator role', async () => {
    authenticatedImpersonatorId = crypto.randomUUID();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/workspaces',
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({code: 'admin-role-required'});
    expect(auth.requireAdminRole).not.toHaveBeenCalled();
  });

  test('maps an insufficient administrator role to forbidden', async () => {
    vi.mocked(auth.requireAdminRole).mockRejectedValue(
      createInterModuleKnownError(
        authInterModuleContract.methods.requireAdminRole,
        'admin-role-required',
        {requiredRole: 'admin-observer'},
      ),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/admin/workspaces',
      headers: {authorization: 'Bearer user'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
      details: {required_role: 'admin-observer'},
    });
  });
});
