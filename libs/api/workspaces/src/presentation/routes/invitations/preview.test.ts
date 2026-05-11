import type {FastifyInstance} from 'fastify';
import {
  createExpiredInvite,
  createInvite,
  createWorkspace,
  createWorkspacesTestApp,
  resetCapturedMail,
  signupVerifyLogin,
  uniqueEmail,
} from '#test/routes.js';

describe('GET /invitations/preview', () => {
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

  test('returns pending invitation metadata without authentication', async () => {
    const owner = await signupVerifyLogin(app, 'invite-preview-owner');
    const workspaceId = await createWorkspace(app, owner.token, 'Acme');
    const inviteeEmail = uniqueEmail('invite-preview');
    const invite = await createInvite(app, {
      token: owner.token,
      workspaceId,
      email: inviteeEmail,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/invitations/preview?token=${encodeURIComponent(invite.rawToken)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        status: 'pending',
        workspace_id: workspaceId,
        workspace_name: 'Acme',
        email: inviteeEmail,
        invited_by_display: owner.email,
        expires_at: expect.any(String),
      }),
    );
  });

  test('returns invalid for unknown tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/invitations/preview?token=${encodeURIComponent(`missing-${crypto.randomUUID()}`)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({status: 'invalid'});
  });

  test('returns expired metadata for expired invitations', async () => {
    const owner = await signupVerifyLogin(app, 'invite-preview-expired-owner');
    const workspaceId = await createWorkspace(app, owner.token, 'Expired Co');
    const rawToken = await createExpiredInvite({
      workspaceId,
      email: uniqueEmail('invite-preview-expired'),
      invitedByUserId: owner.userId,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/invitations/preview?token=${encodeURIComponent(rawToken)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.objectContaining({
        status: 'expired',
        workspace_name: 'Expired Co',
        expires_at: expect.any(String),
      }),
    );
  });

  test('returns already_used after an invitation is accepted', async () => {
    const owner = await signupVerifyLogin(app, 'invite-preview-used-owner');
    const guest = await signupVerifyLogin(app, 'invite-preview-used-guest');
    const workspaceId = await createWorkspace(app, owner.token, 'Used Inc');
    const invite = await createInvite(app, {
      token: owner.token,
      workspaceId,
      email: guest.email,
    });
    const accept = await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: {authorization: `Bearer ${guest.token}`},
      payload: {token: invite.rawToken},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/invitations/preview?token=${encodeURIComponent(invite.rawToken)}`,
    });

    expect(accept.statusCode).toBe(201);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'already_used',
      workspace_name: 'Used Inc',
    });
  });
});
