const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const invitationId = '33333333-3333-4333-8333-333333333333';

describe('workspaces setup helper', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('posts to the workspaces E2E setup route', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: workspaceId,
      name: 'E2E Workspace',
    });
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
    const {createWorkspace} = await import('./index.js');

    const result = await createWorkspace({userId});

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/workspaces', {
      json: {
        user_id: userId,
        user_email: undefined,
        user_name: undefined,
        name: 'E2E Workspace',
      },
    });
    expect(result.id).toBe(workspaceId);
  });

  test('maps workspace params to the setup body', async () => {
    const requestJson = vi.fn().mockResolvedValue({});
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
    const {createWorkspace} = await import('./index.js');

    await createWorkspace({
      userId,
      userEmail: 'owner@example.test',
      userName: 'Owner',
      name: 'Platform',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/workspaces', {
      json: {
        user_id: userId,
        user_email: 'owner@example.test',
        user_name: 'Owner',
        name: 'Platform',
      },
    });
  });

  test('posts invitations to the workspaces setup route', async () => {
    const requestJson = vi.fn().mockResolvedValue({invitation: {id: invitationId}});
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
    const {createInvitation} = await import('./index.js');

    const result = await createInvitation({
      workspaceId,
      email: 'invitee@example.test',
      invitedByUserId: userId,
      invitedByDisplay: 'Owner',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/workspaces/invitations', {
      json: {
        workspace_id: workspaceId,
        email: 'invitee@example.test',
        invited_by_user_id: userId,
        invited_by_display: 'Owner',
      },
    });
    expect(result.invitation.id).toBe(invitationId);
  });
});
