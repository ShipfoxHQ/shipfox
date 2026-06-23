import type {Mailer, MailMessage} from '@shipfox/node-mailer';
import {createMembership} from '#db/memberships.js';
import {userFactory, workspaceFactory} from '#test/index.js';
import {
  InvitationEmailMismatchError,
  OpenInvitationExistsError,
  TokenAlreadyUsedError,
} from './errors.js';
import {acceptWorkspaceInvitation, createWorkspaceInvitation} from './invitations.js';

const testConfig = vi.hoisted(
  (): {
    captured: MailMessage[];
    mailer: Mailer;
    clientBaseUrl: string;
  } => {
    const captured: MailMessage[] = [];
    const mailer: Mailer = {
      send: (message) => {
        captured.push(message);
        return Promise.resolve();
      },
    };
    return {
      captured,
      mailer,
      clientBaseUrl: 'https://app.example.test',
    };
  },
);

vi.mock('#config.js', () => ({
  config: {
    WORKSPACE_JWT_SECRET: 'invitation-core-test-secret',
    WORKSPACE_JWT_EXPIRES_IN: '7d',
    CLIENT_BASE_URL: testConfig.clientBaseUrl,
  },
  mailer: testConfig.mailer,
}));

const TOKEN_RE = /token=([\w\-_=]+)/;

function extractToken(message: MailMessage | undefined): string {
  const match = message?.text?.match(TOKEN_RE);
  if (!match?.[1]) {
    throw new Error('Expected message to contain a token link');
  }
  return match[1];
}

describe('invitations core', () => {
  let captured: MailMessage[];

  beforeEach(() => {
    captured = testConfig.captured;
    captured.length = 0;
  });

  test('createWorkspaceInvitation creates an invitation and sends an email', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    const invitation = await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin'}],
    });

    expect(invitation.email).toBe(email);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.to).toBe(email);
  });

  test('createWorkspaceInvitation sends a branded email with the workspace name and inviter', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByDisplay: 'Dana Scully',
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin'}],
    });

    const message = captured[0];
    expect(message?.subject).toBe(`Join ${workspace.name} on Shipfox`);
    expect(message?.text).toContain(workspace.name);
    expect(message?.html).toContain('Dana Scully');
    expect(message?.text).toContain('Dana Scully has invited you');
  });

  test('createWorkspaceInvitation falls back to "A teammate" when no inviter display is given', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin'}],
    });

    expect(captured[0]?.text).toContain('A teammate has invited you');
  });

  test('createWorkspaceInvitation rejects duplicate open invitations', async () => {
    const inviter = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    const email = `duplicate-${crypto.randomUUID()}@example.com`;
    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin'}],
    });

    const promise = createWorkspaceInvitation({
      workspaceId: workspace.id,
      email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin'}],
    });

    await expect(promise).rejects.toBeInstanceOf(OpenInvitationExistsError);
  });

  test('acceptWorkspaceInvitation accepts once and enforces the invited email', async () => {
    const inviter = userFactory.build();
    const invitee = userFactory.build();
    const workspace = await workspaceFactory.create();
    await createMembership({
      userId: inviter.userId,
      userEmail: inviter.email,
      userName: inviter.name,
      workspaceId: workspace.id,
    });
    await createWorkspaceInvitation({
      workspaceId: workspace.id,
      email: invitee.email,
      invitedByUserId: inviter.userId,
      invitedByMemberships: [{workspaceId: workspace.id, role: 'admin'}],
    });
    const token = extractToken(captured[0]);

    const wrongEmail = acceptWorkspaceInvitation({
      token,
      userId: invitee.userId,
      email: `wrong-${crypto.randomUUID()}@example.com`,
    });
    await expect(wrongEmail).rejects.toBeInstanceOf(InvitationEmailMismatchError);

    const result = await acceptWorkspaceInvitation({
      token,
      userId: invitee.userId,
      email: invitee.email,
    });
    expect(result.membership.workspaceId).toBe(workspace.id);

    const reused = acceptWorkspaceInvitation({token, userId: invitee.userId, email: invitee.email});
    await expect(reused).rejects.toBeInstanceOf(TokenAlreadyUsedError);
  });
});
