import {type AuthState, getAuthRouteRevision} from './auth.js';

const authenticatedUser = {id: 'user-1', email: 'user@example.com'};
const authenticatedWorkspace = {
  id: 'workspace-1',
  name: 'Workspace',
  slug: 'workspace',
  membershipId: 'membership-1',
  status: 'active' as const,
};
const authenticatedState: AuthState = {
  status: 'authenticated',
  token: 'initial-token',
  user: authenticatedUser,
  workspaces: [authenticatedWorkspace],
};

describe('getAuthRouteRevision', () => {
  test('does not change for token-only renewal', () => {
    const renewedState = {...authenticatedState, token: 'renewed-token'};

    expect(getAuthRouteRevision(renewedState)).toBe(getAuthRouteRevision(authenticatedState));
  });

  test('does not change for workspace membership order changes', () => {
    const secondWorkspace = {
      ...authenticatedWorkspace,
      id: 'workspace-2',
      slug: 'other-workspace',
      membershipId: 'membership-2',
    };
    const orderedState = {
      ...authenticatedState,
      workspaces: [authenticatedWorkspace, secondWorkspace],
    };
    const reorderedState = {
      ...authenticatedState,
      workspaces: [secondWorkspace, authenticatedWorkspace],
    };

    expect(getAuthRouteRevision(reorderedState)).toBe(getAuthRouteRevision(orderedState));
  });

  test.each([
    ['a different principal', {...authenticatedState, user: {...authenticatedUser, id: 'user-2'}}],
    [
      'a changed membership',
      {
        ...authenticatedState,
        workspaces: [{...authenticatedWorkspace, slug: 'renamed-workspace'}],
      },
    ],
  ])('changes for %s', (_description, changedState) => {
    expect(getAuthRouteRevision(changedState)).not.toBe(getAuthRouteRevision(authenticatedState));
  });
});
