import type {FastifyInstance} from 'fastify';
import {verifyUserToken} from '#core/jwt.js';
import {
  acceptWorkspaceInvitationMock,
  createAuthTestApp,
  getSetCookie,
  latestMailTo,
  listMembershipsByUserMock,
  peekInvitationByRawTokenMock,
  ROUTE_TEST_SECRET,
  resetCapturedMail,
  signup,
  uniqueEmail,
} from '#test/routes.js';

describe('POST /auth/signup', () => {
  let app: FastifyInstance;
  const password = 'correct horse battery staple';

  beforeAll(async () => {
    app = await createAuthTestApp();
  });

  beforeEach(() => {
    resetCapturedMail();
  });

  afterAll(async () => {
    await app.close();
  });

  test('returns 201 with a pending user and sends verification mail', async () => {
    const email = uniqueEmail('signup');

    const res = await signup(app, {
      email: email.toUpperCase(),
      password,
      name: 'New User',
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().user.email).toBe(email);
    expect(res.json().user.email_verified_at).toBeNull();
    expect(latestMailTo(email).subject).toBe('Verify your email');
  });

  test('transforms duplicate email into 409', async () => {
    const email = uniqueEmail('duplicate');
    await signup(app, {email, password});

    const res = await signup(app, {email, password});

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('email-taken');
  });

  test('accepts a valid invitation during signup and skips verification email', async () => {
    const email = uniqueEmail('signup-invite');
    const invitationToken = `invite-${crypto.randomUUID()}`;
    const workspaceId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    peekInvitationByRawTokenMock.mockResolvedValueOnce({
      id: crypto.randomUUID(),
      workspaceId,
      email,
      hashedToken: 'hashed',
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedAt: null,
      acceptedByUserId: null,
      invitedByUserId: crypto.randomUUID(),
      invitedByDisplay: 'owner@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    acceptWorkspaceInvitationMock.mockImplementationOnce(async (params) => ({
      invitation: {
        id: crypto.randomUUID(),
        workspaceId,
        email,
        hashedToken: 'hashed',
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: new Date(),
        acceptedByUserId: params.userId,
        invitedByUserId: crypto.randomUUID(),
        invitedByDisplay: 'owner@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      membership: {
        id: membershipId,
        userId: params.userId,
        userEmail: email,
        userName: 'Invitee',
        workspaceId,
        workspaceName: 'Acme',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      alreadyMember: false,
    }));
    listMembershipsByUserMock.mockResolvedValueOnce([
      {
        id: membershipId,
        userId: crypto.randomUUID(),
        userEmail: email,
        userName: 'Invitee',
        workspaceId,
        workspaceName: 'Acme',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email,
        password,
        name: 'Invitee',
        invitation_token: invitationToken,
      },
    });
    const body = res.json();
    const claims = await verifyUserToken({token: body.token, secret: ROUTE_TEST_SECRET});

    expect(res.statusCode).toBe(201);
    expect(getSetCookie(res)).toContain('shipfox_refresh_token=');
    expect(body.user.email).toBe(email);
    expect(body.user.email_verified_at).toEqual(expect.any(String));
    expect(body.membership).toEqual({
      id: membershipId,
      user_id: body.user.id,
      workspace_id: workspaceId,
    });
    expect(body.accept_error).toBeUndefined();
    expect(claims.memberships).toEqual([{workspaceId, role: 'admin'}]);
    expect(() => latestMailTo(email)).toThrow();
  });

  test('returns partial success when invitation acceptance fails after user creation', async () => {
    const email = uniqueEmail('signup-invite-partial');
    const workspaceId = crypto.randomUUID();
    peekInvitationByRawTokenMock.mockResolvedValueOnce({
      id: crypto.randomUUID(),
      workspaceId,
      email,
      hashedToken: 'hashed',
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedAt: null,
      acceptedByUserId: null,
      invitedByUserId: crypto.randomUUID(),
      invitedByDisplay: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    acceptWorkspaceInvitationMock.mockRejectedValueOnce(new Error('accept unavailable'));

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email,
        password,
        invitation_token: `invite-${crypto.randomUUID()}`,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().membership).toBeNull();
    expect(res.json().accept_error).toEqual(
      expect.objectContaining({
        code: 'AcceptFailed',
      }),
    );
    expect(res.json().token).toEqual(expect.any(String));
  });

  test.each([
    {
      name: 'invalid token',
      invitation: undefined,
      expectedStatus: 410,
      expectedCode: 'invitation-token-invalid',
    },
    {
      name: 'already accepted token',
      invitation: {
        acceptedAt: new Date(),
        expiresAt: new Date(Date.now() + 86_400_000),
        email: uniqueEmail('signup-invite-used'),
      },
      expectedStatus: 410,
      expectedCode: 'invitation-token-used',
    },
    {
      name: 'expired token',
      invitation: {
        acceptedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
        email: uniqueEmail('signup-invite-expired'),
      },
      expectedStatus: 410,
      expectedCode: 'invitation-token-expired',
    },
    {
      name: 'email mismatch',
      invitation: {
        acceptedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        email: uniqueEmail('signup-invite-other'),
      },
      expectedStatus: 403,
      expectedCode: 'invitation-email-mismatch',
    },
  ])('rejects signup with invitation for $name', async ({
    invitation,
    expectedStatus,
    expectedCode,
  }) => {
    const email = uniqueEmail('signup-invite-error');
    if (invitation === undefined) {
      peekInvitationByRawTokenMock.mockResolvedValueOnce(undefined);
    } else {
      peekInvitationByRawTokenMock.mockResolvedValueOnce({
        id: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        email: invitation.email,
        hashedToken: 'hashed',
        expiresAt: invitation.expiresAt,
        acceptedAt: invitation.acceptedAt,
        acceptedByUserId: null,
        invitedByUserId: crypto.randomUUID(),
        invitedByDisplay: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email,
        password,
        invitation_token: `invite-${crypto.randomUUID()}`,
      },
    });

    expect(res.statusCode).toBe(expectedStatus);
    expect(res.json().code).toBe(expectedCode);
    expect(acceptWorkspaceInvitationMock).not.toHaveBeenCalled();
  });
});
