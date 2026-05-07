import {findMembership} from '#db/memberships.js';
import {userFactory} from '#test/index.js';
import {MembershipRequiredError, WorkspaceNotFoundError} from './errors.js';
import {createWorkspaceForUser, requireWorkspaceMembership} from './workspaces.js';

describe('workspaces core', () => {
  test('createWorkspaceForUser creates a workspace and membership for the user', async () => {
    const user = userFactory.build();

    const workspace = await createWorkspaceForUser({
      name: 'Core Workspace',
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
    });
    const membership = await findMembership({userId: user.userId, workspaceId: workspace.id});

    expect(workspace.name).toBe('Core Workspace');
    expect(membership).toBeDefined();
  });

  test('requireWorkspaceMembership returns the workspace + role when memberships include it', async () => {
    const user = userFactory.build();
    const workspace = await createWorkspaceForUser({
      name: 'Member Workspace',
      userId: user.userId,
      userEmail: user.email,
      userName: user.name,
    });

    const result = await requireWorkspaceMembership({
      workspaceId: workspace.id,
      userId: user.userId,
      memberships: [{workspaceId: workspace.id, role: 'admin'}],
    });

    expect(result.workspace.id).toBe(workspace.id);
    expect(result.userId).toBe(user.userId);
    expect(result.role).toBe('admin');
  });

  test('requireWorkspaceMembership rejects when memberships do not include the workspace', async () => {
    const owner = userFactory.build();
    const outsider = userFactory.build();
    const workspace = await createWorkspaceForUser({
      name: 'Private Workspace',
      userId: owner.userId,
      userEmail: owner.email,
      userName: owner.name,
    });

    const nonMember = requireWorkspaceMembership({
      workspaceId: workspace.id,
      userId: outsider.userId,
      memberships: [],
    });
    await expect(nonMember).rejects.toBeInstanceOf(MembershipRequiredError);
  });

  test('requireWorkspaceMembership rejects with WorkspaceNotFoundError when workspace does not exist', async () => {
    const owner = userFactory.build();
    const ghostId = crypto.randomUUID();

    const missingWorkspace = requireWorkspaceMembership({
      workspaceId: ghostId,
      userId: owner.userId,
      memberships: [{workspaceId: ghostId, role: 'admin'}],
    });

    await expect(missingWorkspace).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });
});
