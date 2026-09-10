import type {
  AdministratorUserSummaryInterModule,
  AuthInterModuleClient,
} from '@shipfox/api-auth-dto/inter-module';
import type {TimestampIdCursor} from '@shipfox/node-drizzle';
import type {Workspace} from '#core/entities/workspace.js';
import {WorkspaceNotFoundError} from '#core/errors.js';
import {
  findMembership,
  listWorkspaceMembershipsPage,
  listWorkspaceMembershipUserIds,
} from '#db/memberships.js';
import {getWorkspaceById} from '#db/workspaces.js';

export type WorkspaceAdministratorMembersCursor =
  | {mode: 'membership'; cursor: TimestampIdCursor}
  | {mode: 'search'; authCursor: string};

export interface WorkspaceAdministratorMembersResult {
  workspace: Pick<Workspace, 'id' | 'name' | 'slug' | 'status'>;
  members: AdministratorUserSummaryInterModule[];
  nextCursor: WorkspaceAdministratorMembersCursor | null;
}

export interface ListWorkspaceAdministratorMembersParams {
  workspaceId: string;
  auth: AuthInterModuleClient;
  limit: number;
  search?: string | undefined;
  cursor?: WorkspaceAdministratorMembersCursor | undefined;
  userId?: string | undefined;
}

function emptyResult(
  workspace: Pick<Workspace, 'id' | 'name' | 'slug' | 'status'>,
): WorkspaceAdministratorMembersResult {
  return {workspace, members: [], nextCursor: null};
}

export async function listWorkspaceAdministratorMembers(
  params: ListWorkspaceAdministratorMembersParams,
): Promise<WorkspaceAdministratorMembersResult> {
  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) throw new WorkspaceNotFoundError(params.workspaceId);

  const workspaceSummary = {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    status: workspace.status,
  } satisfies Pick<Workspace, 'id' | 'name' | 'slug' | 'status'>;

  if (workspace.status !== 'active') return emptyResult(workspaceSummary);

  if (params.userId !== undefined) {
    const membership = await findMembership({
      userId: params.userId,
      workspaceId: params.workspaceId,
    });
    const result = await params.auth.listImpersonationEligibleUserSummaries({
      userIds: [params.userId],
      limit: 1,
    });
    return {
      workspace: workspaceSummary,
      members: membership ? result.users.slice(0, 1) : [],
      nextCursor: null,
    };
  }

  if (params.search !== undefined) {
    const authCursor = params.cursor?.mode === 'search' ? params.cursor.authCursor : undefined;
    const result = await params.auth.listImpersonationEligibleUserSummaries({
      search: params.search,
      limit: params.limit,
      ...(authCursor === undefined ? {} : {cursor: authCursor}),
    });
    const memberUserIds = new Set(
      await listWorkspaceMembershipUserIds({
        workspaceId: params.workspaceId,
        userIds: result.users.map(({id}) => id),
      }),
    );

    return {
      workspace: workspaceSummary,
      members: result.users.filter(({id}) => memberUserIds.has(id)).slice(0, params.limit),
      nextCursor:
        result.nextCursor === null ? null : {mode: 'search', authCursor: result.nextCursor},
    };
  }

  const membershipCursor = params.cursor?.mode === 'membership' ? params.cursor.cursor : undefined;
  const membershipPage = await listWorkspaceMembershipsPage({
    workspaceId: params.workspaceId,
    limit: params.limit,
    ...(membershipCursor === undefined ? {} : {cursor: membershipCursor}),
  });
  const result = await params.auth.listImpersonationEligibleUserSummaries({
    userIds: membershipPage.memberships.map(({userId}) => userId),
    limit: params.limit,
  });

  return {
    workspace: workspaceSummary,
    members: result.users.slice(0, params.limit),
    nextCursor:
      membershipPage.nextCursor === null
        ? null
        : {mode: 'membership', cursor: membershipPage.nextCursor},
  };
}
