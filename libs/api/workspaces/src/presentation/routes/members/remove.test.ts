import {WORKSPACES_MEMBER_REMOVED} from '@shipfox/api-workspaces-dto';
import {and, eq, sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import {db} from '#db/db.js';
import {workspacesOutbox} from '#db/schema/outbox.js';
import {
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  resetCapturedMail,
  signupVerifyLogin,
} from '#test/routes.js';

describe('DELETE /workspaces/:workspaceId/members/:userId', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createWorkspacesTestApp();
  });

  beforeEach(() => {
    resetCapturedMail();
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns 204 and removes a non-owner member', async () => {
    const owner = await signupVerifyLogin(app, 'members-remove-owner');
    const guest = await signupVerifyLogin(app, 'members-remove-guest');
    const workspaceId = await createWorkspace(app, owner.token);
    const invite = await createInvite(app, {token: owner.token, workspaceId, email: guest.email});
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: invite.rawToken},
    });

    const remove = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${guest.userId}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });
    const members = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/members`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(remove.statusCode).toBe(204);
    expect(members.statusCode).toBe(200);

    const removedEvents = await db()
      .select()
      .from(workspacesOutbox)
      .where(
        and(
          eq(workspacesOutbox.eventType, WORKSPACES_MEMBER_REMOVED),
          sql`${workspacesOutbox.payload}->>'workspaceId' = ${workspaceId}`,
        ),
      );
    expect(removedEvents).toHaveLength(1);
    expect(removedEvents[0]?.payload).toMatchObject({
      workspaceId,
      userId: guest.userId,
      actorUserId: owner.userId,
    });
    expect(members.json().members).toHaveLength(1);
    expect(members.json().members[0].user_id).toBe(owner.userId);
  });

  test('transforms missing member into 404', async () => {
    const owner = await signupVerifyLogin(app, 'members-remove-missing');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${crypto.randomUUID()}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not-found');
  });

  test('transforms removing yourself into 409 self-removal-not-allowed', async () => {
    const owner = await signupVerifyLogin(app, 'members-remove-self');
    const workspaceId = await createWorkspace(app, owner.token);

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${owner.userId}`,
      headers: {authorization: `Bearer ${owner.token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('self-removal-not-allowed');
  });

  test('returns workspace-suspended for a suspended membership claim', async () => {
    const workspaceId = crypto.randomUUID();
    const token = `claim:${crypto.randomUUID()}:suspended-member-remove@example.com:${workspaceId}:suspended`;

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${crypto.randomUUID()}`,
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
  });

  test('transforms missing membership into 403', async () => {
    const outsider = await signupVerifyLogin(app, 'members-remove-outsider');
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${userId}`,
      headers: {authorization: `Bearer ${outsider.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('checks workspace membership before self-removal', async () => {
    const outsider = await signupVerifyLogin(app, 'members-remove-self-outsider');
    const workspaceId = crypto.randomUUID();

    const res = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/members/${outsider.userId}`,
      headers: {authorization: `Bearer ${outsider.token}`},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
