import type {TurnAdmissionWorkspaces} from '#core/turn-admission.js';

/**
 * Fake Workspaces client for turn admission. It reads the operating state of a workspace and the
 * memberships of a user, so every test starts with an active workspace and a member owner.
 */
export function createTestWorkspacesClient() {
  const state = {
    status: 'active' as 'active' | 'suspended' | 'deleted',
    memberOf: new Set<string>(),
    stateError: undefined as unknown,
  };
  const client: TurnAdmissionWorkspaces = {
    getWorkspaceOperatingState: vi.fn(() => {
      if (state.stateError !== undefined) return Promise.reject(state.stateError);
      return Promise.resolve({status: state.status});
    }),
    listMembershipsForTokenClaims: vi.fn(() =>
      Promise.resolve({
        memberships: [...state.memberOf].map((workspaceId) => ({
          workspaceId,
          workspaceSlug: 'workspace',
          role: 'admin' as const,
          workspaceStatus: 'active' as const,
        })),
      }),
    ),
  };
  return {client, state};
}
