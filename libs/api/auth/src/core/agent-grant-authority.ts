import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {findAgentGrant} from '#db/agent-access.js';
import {findUserById} from '#db/users.js';
import {
  type AgentGrantAuthorityRevocationReason,
  AgentGrantAuthorityRevokedError,
  AuthDependencyUnavailableError,
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

async function assertActiveGrantAndUser(params: CheckAgentGrantAuthorityParams): Promise<void> {
  const grant = await findAgentGrant({id: params.grantId});
  const grantMatchesRequest =
    grant &&
    grant.revokedAt === null &&
    grant.terminalAt === null &&
    grant.userId === params.userId &&
    grant.workspaceId === params.workspaceId;
  if (!grantMatchesRequest) revoked('grant-revoked');

  const user = await findUserById({id: params.userId});
  if (user?.status !== 'active') revoked('user-inactive');
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
      if (error.code === 'workspace-inactive') revoked('workspace-suspended');
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
