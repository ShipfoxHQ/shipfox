import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, sql} from 'drizzle-orm';
import {config} from '#config.js';
import {WorkspaceMembershipCapExceededError} from '#core/errors.js';
import {db} from './db.js';
import {
  createInvitation,
  listOpenInvitationsByWorkspace,
  reconcileInvitationAcceptance,
} from './invitations.js';
import {createMembership, ensureMembership} from './memberships.js';
import {invitations} from './schema/invitations.js';
import {memberships} from './schema/memberships.js';
import {createWorkspace} from './workspaces.js';

async function seedMemberships(
  workspaceId: string,
  count = config.WORKSPACES_MAX_PER_WORKSPACE,
): Promise<string[]> {
  const userIds = Array.from({length: count}, () => crypto.randomUUID());
  await db()
    .insert(memberships)
    .values(
      userIds.map((userId) => ({
        userId,
        userEmail: `${userId}@example.com`,
        userName: null,
        workspaceId,
      })),
    );
  return userIds;
}

async function createTestWorkspace() {
  return await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
}

async function seedOpenInvitations(workspaceId: string, count: number): Promise<void> {
  await db()
    .insert(invitations)
    .values(
      Array.from({length: count}, () => ({
        workspaceId,
        email: `${crypto.randomUUID()}@example.com`,
        hashedToken: hashOpaqueToken(crypto.randomUUID()),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitedByUserId: crypto.randomUUID(),
      })),
    );
}

async function createTestInvitation(workspaceId: string, invitedByUserId = crypto.randomUUID()) {
  return await createInvitation({
    workspaceId,
    email: `${crypto.randomUUID()}@example.com`,
    hashedToken: hashOpaqueToken(crypto.randomUUID()),
    expiresAt: new Date(Date.now() + 86_400_000),
    invitedByUserId,
    skipEmail: true,
  });
}

describe('workspace membership cap', () => {
  test('binds createMembership without deleting existing members', async () => {
    const workspace = await createTestWorkspace();
    const existingUserIds = await seedMemberships(workspace.id);

    await expect(
      createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id}),
    ).rejects.toBeInstanceOf(WorkspaceMembershipCapExceededError);

    const rows = await db()
      .select({userId: memberships.userId})
      .from(memberships)
      .where(eq(memberships.workspaceId, workspace.id));
    expect(rows.map(({userId}) => userId)).toEqual(expect.arrayContaining(existingUserIds));
    expect(rows).toHaveLength(config.WORKSPACES_MAX_PER_WORKSPACE);
  });

  test('binds ensureMembership at the cap', async () => {
    const workspace = await createTestWorkspace();
    await seedMemberships(workspace.id);

    await expect(
      ensureMembership({
        userId: crypto.randomUUID(),
        userEmail: `${crypto.randomUUID()}@example.com`,
        userName: null,
        workspaceId: workspace.id,
      }),
    ).rejects.toBeInstanceOf(WorkspaceMembershipCapExceededError);
  });

  test('counts open invitations as seats', async () => {
    const workspace = await createTestWorkspace();
    await seedMemberships(workspace.id, 1);
    await seedOpenInvitations(workspace.id, config.WORKSPACES_MAX_PER_WORKSPACE - 1);

    await expect(createTestInvitation(workspace.id)).rejects.toBeInstanceOf(
      WorkspaceMembershipCapExceededError,
    );
    expect(await listOpenInvitationsByWorkspace({workspaceId: workspace.id})).toHaveLength(
      config.WORKSPACES_MAX_PER_WORKSPACE - 1,
    );
  });

  test('rejects invitation acceptance after another member takes the last seat', async () => {
    const workspace = await createTestWorkspace();
    await seedMemberships(workspace.id, config.WORKSPACES_MAX_PER_WORKSPACE - 2);
    const invitation = await createTestInvitation(workspace.id);
    const accepterId = crypto.randomUUID();
    await seedMemberships(workspace.id, 2);

    await expect(
      reconcileInvitationAcceptance({
        invitationId: invitation.id,
        acceptedByUserId: accepterId,
        email: invitation.email,
      }),
    ).rejects.toBeInstanceOf(WorkspaceMembershipCapExceededError);

    const storedInvitation = await db()
      .select({acceptedAt: invitations.acceptedAt})
      .from(invitations)
      .where(eq(invitations.id, invitation.id));
    expect(storedInvitation[0]?.acceptedAt).toBeNull();
    expect(
      await db().select().from(memberships).where(eq(memberships.workspaceId, workspace.id)),
    ).toHaveLength(config.WORKSPACES_MAX_PER_WORKSPACE);
    expect(
      await db()
        .select()
        .from(memberships)
        .where(and(eq(memberships.workspaceId, workspace.id), eq(memberships.userId, accepterId))),
    ).toHaveLength(0);
  });

  test('serializes concurrent admissions at the last seat', async () => {
    const workspace = await createTestWorkspace();
    await seedMemberships(workspace.id, config.WORKSPACES_MAX_PER_WORKSPACE - 1);

    const results = await Promise.allSettled([
      createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id}),
      createMembership({userId: crypto.randomUUID(), workspaceId: workspace.id}),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const count = await db()
      .select({count: sql<number>`count(*)::int`})
      .from(memberships)
      .where(eq(memberships.workspaceId, workspace.id));
    expect(count[0]?.count).toBe(config.WORKSPACES_MAX_PER_WORKSPACE);
  });
});
