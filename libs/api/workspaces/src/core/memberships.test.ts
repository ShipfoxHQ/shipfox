import {listMembershipsByWorkspace} from '#db/memberships.js';
import {userFactory, workspaceFactory} from '#test/index.js';
import {ensureMembership} from './memberships.js';

describe('ensureMembership', () => {
  test('creates a membership', async () => {
    const user = userFactory.build();
    const workspace = await workspaceFactory.create();

    const membership = await ensureMembership({
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
      workspaceId: workspace.id,
    });

    expect(membership).toMatchObject({
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
      workspaceId: workspace.id,
    });
  });

  test('returns the existing membership without refreshing its profile snapshot', async () => {
    const user = userFactory.build();
    const workspace = await workspaceFactory.create();
    const first = await ensureMembership({
      userId: user.userId,
      userEmail: user.email,
      userName: 'Original Name',
      workspaceId: workspace.id,
    });
    const second = await ensureMembership({
      userId: user.userId,
      userEmail: `replacement-${crypto.randomUUID()}@example.com`,
      userName: 'Replacement Name',
      workspaceId: workspace.id,
    });

    expect(second).toEqual(first);
  });

  test('uses the database constraint to converge concurrent calls on one membership', async () => {
    const user = userFactory.build();
    const workspace = await workspaceFactory.create();

    const results = await Promise.all(
      Array.from({length: 8}, () =>
        ensureMembership({
          userId: user.userId,
          userEmail: user.email,
          userName: user.name,
          workspaceId: workspace.id,
        }),
      ),
    );
    const memberships = await listMembershipsByWorkspace({workspaceId: workspace.id});

    expect(new Set(results.map((membership) => membership.id)).size).toBe(1);
    expect(memberships).toHaveLength(1);
  });
});
