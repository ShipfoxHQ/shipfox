import {hashOpaqueToken} from '@shipfox/node-tokens';
import {eq, sql} from 'drizzle-orm';
import {OpenInvitationExistsError} from '#core/errors.js';
import {db} from './db.js';
import {
  createInvitation,
  findInvitationByToken,
  listOpenInvitationsByWorkspace,
  reconcileInvitationAcceptance,
  revokeInvitation,
} from './invitations.js';
import {invitations} from './schema/invitations.js';
import {memberships} from './schema/memberships.js';
import {createWorkspace} from './workspaces.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

async function createUser(params: {email: string; hashedPassword?: string; name?: string}) {
  await Promise.resolve();
  return {userId: crypto.randomUUID(), email: params.email, name: null};
}

describe('invitations db', () => {
  test('creates an invitation', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    const invitation = await createInvitation({
      workspaceId: workspace.id,
      email: emailFor('guest'),
      hashedToken: hashOpaqueToken('inv-1'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    expect(invitation.workspaceId).toBe(workspace.id);
    expect(invitation.acceptedAt).toBeNull();
  });

  test('rejects when an unexpired open invite already exists', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const guest = emailFor('guest');
    await createInvitation({
      workspaceId: workspace.id,
      email: guest,
      hashedToken: hashOpaqueToken('first'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    await expect(
      createInvitation({
        workspaceId: workspace.id,
        email: guest,
        hashedToken: hashOpaqueToken('second'),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedByUserId: inviter.userId,
        skipEmail: true,
      }),
    ).rejects.toBeInstanceOf(OpenInvitationExistsError);
  });

  test('on create, expired invites for same (workspace, email) are deleted first', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const guest = emailFor('guest');
    const expiredToken = hashOpaqueToken('expired-inv');
    await db().insert(invitations).values({
      workspaceId: workspace.id,
      email: guest,
      hashedToken: expiredToken,
      expiresAt: sql`now() - interval '1 day'`,
      invitedByUserId: inviter.userId,
    });

    const fresh = await createInvitation({
      workspaceId: workspace.id,
      email: guest,
      hashedToken: hashOpaqueToken('fresh-inv'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    expect(fresh.id).toBeDefined();
    const stillThere = await db()
      .select()
      .from(invitations)
      .where(eq(invitations.hashedToken, expiredToken));
    expect(stillThere).toHaveLength(0);
  });

  test('reconcileInvitationAcceptance creates membership + marks accepted transactionally', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const accepter = await createUser({email: emailFor('accepter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: accepter.email,
      hashedToken: hashOpaqueToken('inv-accept'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    const result = await reconcileInvitationAcceptance({
      invitationId: inv.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.invitation.acceptedAt).toBeInstanceOf(Date);
      expect(result.invitation.acceptedByUserId).toBe(accepter.userId);
      expect(result.membership.userId).toBe(accepter.userId);
      expect(result.alreadyMember).toBe(false);
    }
  });

  test('reconcileInvitationAcceptance accepts an existing member', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const member = await createUser({email: emailFor('member'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const {createMembership} = await import('./memberships.js');
    const existing = await createMembership({userId: member.userId, workspaceId: workspace.id});
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: member.email,
      hashedToken: hashOpaqueToken('inv-idem'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    const result = await reconcileInvitationAcceptance({
      invitationId: inv.id,
      acceptedByUserId: member.userId,
      email: member.email,
    });

    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') {
      expect(result.alreadyMember).toBe(true);
      expect(result.membership.id).toBe(existing.id);
    }
  });

  test('reconciles a retry after the initial acceptance commits', async () => {
    const inviter = await createUser({email: emailFor('inviter')});
    const accepter = await createUser({email: emailFor('accepter')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const invitation = await createInvitation({
      workspaceId: workspace.id,
      email: accepter.email,
      hashedToken: hashOpaqueToken(`retry-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    await reconcileInvitationAcceptance({
      invitationId: invitation.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });
    const retry = await reconcileInvitationAcceptance({
      invitationId: invitation.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });

    expect(retry.status).toBe('already_accepted');
    if (retry.status === 'already_accepted') {
      expect(retry.membership.userId).toBe(accepter.userId);
    }
  });

  test('reconciles an accepted invitation after expiry and email changes', async () => {
    const inviter = await createUser({email: emailFor('inviter')});
    const accepter = await createUser({email: emailFor('accepter')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const invitation = await createInvitation({
      workspaceId: workspace.id,
      email: accepter.email,
      hashedToken: hashOpaqueToken(`accepted-expired-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });
    await reconcileInvitationAcceptance({
      invitationId: invitation.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });
    await db()
      .update(invitations)
      .set({expiresAt: new Date(Date.now() - 1_000)})
      .where(eq(invitations.id, invitation.id));

    const retry = await reconcileInvitationAcceptance({
      invitationId: invitation.id,
      acceptedByUserId: accepter.userId,
      email: emailFor('different-address'),
    });

    expect(retry.status).toBe('already_accepted');
  });

  test('serializes concurrent acceptance and rejects the other user', async () => {
    const inviter = await createUser({email: emailFor('inviter')});
    const firstUser = await createUser({email: emailFor('first')});
    const secondUser = await createUser({email: emailFor('second')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const invitationEmail = emailFor('guest');
    const invitation = await createInvitation({
      workspaceId: workspace.id,
      email: invitationEmail,
      hashedToken: hashOpaqueToken(`race-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    const results = await Promise.all([
      reconcileInvitationAcceptance({
        invitationId: invitation.id,
        acceptedByUserId: firstUser.userId,
        email: invitationEmail,
      }),
      reconcileInvitationAcceptance({
        invitationId: invitation.id,
        acceptedByUserId: secondUser.userId,
        email: invitationEmail,
      }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'accepted',
      'consumed_by_another_user',
    ]);
    const accepted = results.find((result) => result.status === 'accepted');
    const membershipsForWorkspace = await db()
      .select()
      .from(memberships)
      .where(eq(memberships.workspaceId, workspace.id));
    expect(accepted?.status).toBe('accepted');
    expect(membershipsForWorkspace).toHaveLength(1);
    expect(membershipsForWorkspace[0]?.userId).toBe(
      accepted?.status === 'accepted' ? accepted.invitation.acceptedByUserId : undefined,
    );
  });

  test('returns revoked without granting membership', async () => {
    const inviter = await createUser({email: emailFor('inviter')});
    const accepter = await createUser({email: emailFor('accepter')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const invitation = await createInvitation({
      workspaceId: workspace.id,
      email: accepter.email,
      hashedToken: hashOpaqueToken(`revoked-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });
    await revokeInvitation({invitationId: invitation.id});

    const result = await reconcileInvitationAcceptance({
      invitationId: invitation.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });

    expect(result).toEqual({status: 'revoked'});
  });

  test('reconcileInvitationAcceptance returns expired before granting membership', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const accepter = await createUser({email: emailFor('accepter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const expiredToken = hashOpaqueToken('expired-accept');
    const [inserted] = await db()
      .insert(invitations)
      .values({
        workspaceId: workspace.id,
        email: accepter.email,
        hashedToken: expiredToken,
        expiresAt: sql`now() - interval '1 second'`,
        invitedByUserId: inviter.userId,
      })
      .returning();
    if (!inserted) throw new Error('insert failed');

    const result = await reconcileInvitationAcceptance({
      invitationId: inserted.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });

    expect(result).toEqual({status: 'expired'});
  });

  test('lists only open invitations and revokes them', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: emailFor('guest'),
      hashedToken: hashOpaqueToken('inv-list'),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    const before = await listOpenInvitationsByWorkspace({workspaceId: workspace.id});
    await revokeInvitation({invitationId: inv.id});
    const after = await listOpenInvitationsByWorkspace({workspaceId: workspace.id});

    expect(before.some((i) => i.id === inv.id)).toBe(true);
    expect(after.some((i) => i.id === inv.id)).toBe(false);
  });

  test('does not revoke an accepted invitation receipt', async () => {
    const inviter = await createUser({email: emailFor('inviter')});
    const accepter = await createUser({email: emailFor('accepter')});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const invitation = await createInvitation({
      workspaceId: workspace.id,
      email: accepter.email,
      hashedToken: hashOpaqueToken(`accepted-revoke-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });
    await reconcileInvitationAcceptance({
      invitationId: invitation.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });

    await revokeInvitation({invitationId: invitation.id});
    const retry = await reconcileInvitationAcceptance({
      invitationId: invitation.id,
      acceptedByUserId: accepter.userId,
      email: accepter.email,
    });

    expect(retry.status).toBe('already_accepted');
  });

  test('findInvitationByToken returns matching row', async () => {
    const inviter = await createUser({email: emailFor('inviter'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const tokenHash = hashOpaqueToken('inv-find');
    const inv = await createInvitation({
      workspaceId: workspace.id,
      email: emailFor('guest'),
      hashedToken: tokenHash,
      expiresAt: new Date(Date.now() + 86_400_000),
      invitedByUserId: inviter.userId,
      skipEmail: true,
    });

    const found = await findInvitationByToken({hashedToken: tokenHash});

    expect(found?.id).toBe(inv.id);
  });
});
