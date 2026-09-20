import {eq} from 'drizzle-orm';
import {LastMemberError} from '#core/errors.js';
import {db} from './db.js';
import {
  createMembership,
  findMembership,
  listMembershipsByUser,
  listMembershipsByWorkspace,
  removeMembership,
} from './memberships.js';
import {memberships} from './schema/memberships.js';
import {createWorkspace} from './workspaces.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

async function createUser(params: {email: string; hashedPassword?: string; name?: string}) {
  await Promise.resolve();
  return {userId: crypto.randomUUID(), email: params.email, name: null};
}

describe('memberships db', () => {
  test('creates a membership', async () => {
    const user = await createUser({email: emailFor('m1'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});

    const membership = await createMembership({userId: user.userId, workspaceId: workspace.id});

    expect(membership.userId).toBe(user.userId);
    expect(membership.workspaceId).toBe(workspace.id);
  });

  test('rejects duplicate (user_id, workspace_id)', async () => {
    const user = await createUser({email: emailFor('dup'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    await createMembership({userId: user.userId, workspaceId: workspace.id});

    await expect(
      createMembership({userId: user.userId, workspaceId: workspace.id}),
    ).rejects.toThrow();
  });

  test('lists memberships by user joined with workspace name', async () => {
    const user = await createUser({email: emailFor('listu'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Listed-${crypto.randomUUID()}`});
    await createMembership({userId: user.userId, workspaceId: workspace.id});

    const list = await listMembershipsByUser({userId: user.userId});

    expect(list).toHaveLength(1);
    expect(list[0]?.workspaceName).toBe(workspace.name);
  });

  test('lists memberships sorted by workspace name ascending', async () => {
    const user = await createUser({email: emailFor('order'), hashedPassword: 'h'});
    const suffix = crypto.randomUUID();
    const charlie = await createWorkspace({name: `order-${suffix}-Charlie`});
    const alpha = await createWorkspace({name: `order-${suffix}-Alpha`});
    const bravo = await createWorkspace({name: `order-${suffix}-Bravo`});
    await createMembership({userId: user.userId, workspaceId: charlie.id});
    await createMembership({userId: user.userId, workspaceId: alpha.id});
    await createMembership({userId: user.userId, workspaceId: bravo.id});

    const list = await listMembershipsByUser({userId: user.userId});

    expect(list.map((m) => m.workspaceName)).toEqual([alpha.name, bravo.name, charlie.name]);
  });

  test('lists memberships by workspace joined with user info', async () => {
    const user = await createUser({email: emailFor('listt'), hashedPassword: 'h', name: 'Listy'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    await createMembership({
      userId: user.userId,
      userEmail: user.email,
      userName: 'Listy',
      workspaceId: workspace.id,
    });

    const list = await listMembershipsByWorkspace({workspaceId: workspace.id});

    expect(list).toHaveLength(1);
    expect(list[0]?.userEmail).toBe(user.email);
    expect(list[0]?.userName).toBe('Listy');
  });

  test('lists memberships by workspace in deterministic creation order', async () => {
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    const oldest = await createMembership({
      userId: crypto.randomUUID(),
      workspaceId: workspace.id,
    });
    const middle = await createMembership({
      userId: crypto.randomUUID(),
      workspaceId: workspace.id,
    });
    const newest = await createMembership({
      userId: crypto.randomUUID(),
      workspaceId: workspace.id,
    });
    const baseCreatedAt = new Date('2025-01-01T00:00:00.000Z');
    const sameCreatedAt = new Date(baseCreatedAt.getTime() + 1_000);

    await db()
      .update(memberships)
      .set({createdAt: new Date(baseCreatedAt.getTime() + 2_000)})
      .where(eq(memberships.id, oldest.id));
    await db()
      .update(memberships)
      .set({createdAt: sameCreatedAt})
      .where(eq(memberships.id, middle.id));
    await db()
      .update(memberships)
      .set({createdAt: sameCreatedAt})
      .where(eq(memberships.id, newest.id));

    const sameCreatedAtOrder = [middle, newest].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const firstRead = await listMembershipsByWorkspace({workspaceId: workspace.id});
    const secondRead = await listMembershipsByWorkspace({workspaceId: workspace.id});

    expect(firstRead.map((membership) => membership.id)).toEqual([
      ...sameCreatedAtOrder.map(({id}) => id),
      oldest.id,
    ]);
    expect(secondRead.map((membership) => membership.id)).toEqual(
      firstRead.map((membership) => membership.id),
    );
  });

  test('removeMembership succeeds when ≥2 members exist', async () => {
    const userA = await createUser({email: emailFor('a'), hashedPassword: 'h'});
    const userB = await createUser({email: emailFor('b'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    await createMembership({userId: userA.userId, workspaceId: workspace.id});
    await createMembership({userId: userB.userId, workspaceId: workspace.id});

    await removeMembership({userId: userA.userId, workspaceId: workspace.id});

    expect(await findMembership({userId: userA.userId, workspaceId: workspace.id})).toBeUndefined();
    expect(await findMembership({userId: userB.userId, workspaceId: workspace.id})).toBeDefined();
  });

  test('removeMembership rejects when only 1 member exists', async () => {
    const user = await createUser({email: emailFor('only'), hashedPassword: 'h'});
    const workspace = await createWorkspace({name: `Workspace ${crypto.randomUUID()}`});
    await createMembership({userId: user.userId, workspaceId: workspace.id});

    await expect(
      removeMembership({userId: user.userId, workspaceId: workspace.id}),
    ).rejects.toBeInstanceOf(LastMemberError);
    expect(await findMembership({userId: user.userId, workspaceId: workspace.id})).toBeDefined();
  });
});
