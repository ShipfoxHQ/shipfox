import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {findAgentGrant} from '#db/agent-access.js';
import {findImpersonationWindow} from '#db/impersonation-windows.js';
import {findUserById} from '#db/users.js';
import {requireAdminRole} from './admin-role.js';
import {
  type AgentGrantAuthorityRevocationReason,
  AgentGrantAuthorityRevokedError,
  AuthDependencyUnavailableError,
  ImpersonationWindowNotFoundError,
} from './errors.js';

export interface CheckAgentGrantAuthorityParams {
  grantId: string;
  userId: string;
  workspaceId: string;
  workspaces: WorkspacesInterModuleClient;
}

function revoked(reason: AgentGrantAuthorityRevocationReason): never {
  throw new AgentGrantAuthorityRevokedError(reason);
}

function workspaceInactiveRevocationReason(
  status: 'active' | 'suspended' | 'deleted' | undefined,
): AgentGrantAuthorityRevocationReason {
  return status === 'deleted' ? 'workspace-deleted' : 'workspace-suspended';
}

async function findActiveGrant(params: {grantId: string; userId: string}) {
  const grant = await findAgentGrant({id: params.grantId});
  const active =
    grant &&
    grant.revokedAt === null &&
    grant.terminalAt === null &&
    grant.userId === params.userId;
  return active ? grant : revoked('grant-revoked');
}

async function assertActiveUser(userId: string): Promise<void> {
  const user = await findUserById({id: userId});
  if (user?.status !== 'active') revoked('user-inactive');
}

async function assertActiveGrantAndUser(params: CheckAgentGrantAuthorityParams): Promise<void> {
  const grant = await findActiveGrant(params);
  if (grant.workspaceId !== params.workspaceId) revoked('grant-revoked');
  await assertActiveUser(params.userId);
}

async function assertActiveWorkspaceMembership(
  params: CheckAgentGrantAuthorityParams,
): Promise<void> {
  let memberships: Awaited<
    ReturnType<WorkspacesInterModuleClient['listMembershipsForTokenClaims']>
  >;
  try {
    memberships = await params.workspaces.listMembershipsForTokenClaims({userId: params.userId});
  } catch (error) {
    throw new AuthDependencyUnavailableError('workspaces', error);
  }

  const membership = memberships.memberships.find(
    (candidate) => candidate.workspaceId === params.workspaceId,
  );

  try {
    await params.workspaces.requireActiveMembership({
      userId: params.userId,
      workspaceId: params.workspaceId,
      memberships: memberships.memberships,
    });
  } catch (error) {
    const method = workspacesInterModuleContract.methods.requireActiveMembership;
    if (isInterModuleKnownError(method, error)) {
      if (error.code === 'membership-required') revoked('membership-revoked');
      if (error.code === 'workspace-not-found') revoked('workspace-deleted');
      if (error.code === 'workspace-inactive') {
        revoked(workspaceInactiveRevocationReason(membership?.workspaceStatus));
      }
    }
    throw new AuthDependencyUnavailableError('workspaces', error);
  }

  if (!membership) revoked('membership-revoked');
}

export async function checkAgentGrantAuthority(
  params: CheckAgentGrantAuthorityParams,
): Promise<{ok: true}> {
  await assertActiveGrantAndUser(params);
  await assertActiveWorkspaceMembership(params);
  return {ok: true};
}

export interface CheckImpersonatedAgentGrantAuthorityParams {
  grantId: string;
  userId: string;
  workspaceId: string;
  windowId: string;
}

/**
 * An administrator reads a customer workspace through an impersonation window,
 * not a membership, and their grant belongs to their own workspace. The window
 * replaces the workspace and membership checks.
 */
export async function checkImpersonatedAgentGrantAuthority(
  params: CheckImpersonatedAgentGrantAuthorityParams,
): Promise<void> {
  await findActiveGrant(params);
  await assertActiveUser(params.userId);
  await requireAdminRole({userId: params.userId, minimumRole: 'admin-operator'});

  const window = await findImpersonationWindow({id: params.windowId});
  const open =
    window !== undefined &&
    window.actorId === params.userId &&
    window.workspaceId === params.workspaceId &&
    window.endedAt === null &&
    window.deadlineAt.getTime() > Date.now();
  if (!open) throw new ImpersonationWindowNotFoundError();
}
