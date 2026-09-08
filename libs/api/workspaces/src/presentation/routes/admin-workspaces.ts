import {
  AUTH_USER,
  adoptAdministrationActorGuard,
  getUserContext,
  requireAdministrationActor,
} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  listWorkspaceAdminMembersResponseSchema,
  listWorkspaceAdminSummariesResponseSchema,
  type WorkspaceAdminMembersQueryDto,
  workspaceAdministrationMutationBodySchema,
  workspaceAdministrationMutationResponseSchema,
  workspaceAdminLookupQuerySchema,
  workspaceAdminMembersParamsSchema,
  workspaceAdminMembersQuerySchema,
} from '@shipfox/api-workspaces-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {decodeStringIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {
  listWorkspaceAdministratorMembers,
  type WorkspaceAdministratorMembersCursor,
} from '#core/admin-workspace-members.js';
import {
  listWorkspaceAdministratorSummaries,
  reactivateWorkspace,
  suspendWorkspace,
  type WorkspaceAdministrationMutationContext,
  type WorkspaceAdministratorSummary,
} from '#core/admin-workspaces.js';
import {
  WorkspaceAdminIdempotencyKeyReuseError,
  WorkspaceAlreadySuspendedError,
  WorkspaceDeletedError,
  WorkspaceNotFoundError,
  WorkspaceNotSuspendedError,
} from '#core/errors.js';
import {createWorkspaceAdminMembersRateLimitPreHandler} from './rate-limit.js';

const idempotencyKeyMaxLength = 256;

function requireActorId(request: FastifyRequest): string {
  const client = getUserContext(request);
  if (!client) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }
  return client.userId;
}

function requireIdempotencyKey(request: FastifyRequest): string {
  const value = request.headers['idempotency-key'];
  const key = Array.isArray(value) ? value[0] : value;
  if (!key || key.trim().length === 0 || key.length > idempotencyKeyMaxLength) {
    throw new ClientError('Idempotency-Key header is required', 'idempotency-key-required', {
      status: 400,
    });
  }
  return key;
}

function translateAdminRoleError(error: unknown, message: string): void {
  if (
    isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error) &&
    error.code === 'admin-role-required'
  ) {
    throw new ClientError(message, 'forbidden', {
      status: 403,
      details: {required_role: error.details.requiredRole},
    });
  }
}

function translateAdministrationError(error: unknown): never {
  translateAdminRoleError(error, 'Administrator operator role required');
  if (error instanceof WorkspaceNotFoundError) {
    throw new ClientError('Workspace not found', 'workspace-not-found', {status: 404});
  }
  if (error instanceof WorkspaceDeletedError) {
    throw new ClientError('Workspace is deleted', 'workspace-deleted', {status: 409});
  }
  if (error instanceof WorkspaceAlreadySuspendedError) {
    throw new ClientError('Workspace is already suspended', 'workspace-already-suspended', {
      status: 409,
    });
  }
  if (error instanceof WorkspaceNotSuspendedError) {
    throw new ClientError('Workspace is not suspended', 'workspace-not-suspended', {
      status: 409,
    });
  }
  if (error instanceof WorkspaceAdminIdempotencyKeyReuseError) {
    throw new ClientError(
      'Idempotency-Key was already used for a different workspace command',
      'idempotency-key-reused',
      {status: 409},
    );
  }
  throw error;
}

function translateObserverAdministrationError(error: unknown): never {
  translateAdminRoleError(error, 'Administrator observer role required');
  throw error;
}

function toWorkspaceAdministrationMutationDto(result: {
  workspaceId: string;
  status: 'active' | 'suspended';
  correlationId: string;
}) {
  return {
    workspace_id: result.workspaceId,
    status: result.status,
    correlation_id: result.correlationId,
  };
}

function toWorkspaceAdministratorSummaryDto(summary: WorkspaceAdministratorSummary) {
  return {
    id: summary.id,
    name: summary.name,
    slug: summary.slug,
    status: summary.status,
    member_summary: summary.memberSummary,
    project_summary: summary.projectSummary,
    job_counts: summary.jobCounts,
    created_at: summary.createdAt.toISOString(),
    updated_at: summary.updatedAt.toISOString(),
  };
}

function toWorkspaceAdministratorMemberDto(member: {
  id: string;
  email: string;
  name: string | null;
  status: 'active' | 'suspended' | 'deleted';
  emailVerifiedAt: string | null;
  createdAt: string;
  adminRole: 'admin-observer' | 'admin-operator' | 'admin-owner' | null;
}) {
  return {
    id: member.id,
    email: member.email,
    name: member.name,
    status: member.status,
    email_verified_at: member.emailVerifiedAt,
    created_at: member.createdAt,
    admin_role: member.adminRole,
  };
}

const workspaceAdministratorMembersCursorSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('membership'),
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
  }),
  z.object({
    mode: z.literal('search'),
    authCursor: z.string().min(1).max(512),
  }),
]);

function encodeWorkspaceAdministratorMembersCursor(
  cursor: WorkspaceAdministratorMembersCursor,
): string {
  return Buffer.from(
    JSON.stringify(
      cursor.mode === 'membership'
        ? {
            mode: cursor.mode,
            createdAt: cursor.cursor.createdAt.toISOString(),
            id: cursor.cursor.id,
          }
        : {mode: cursor.mode, authCursor: cursor.authCursor},
    ),
    'utf8',
  ).toString('base64url');
}

function decodeWorkspaceAdministratorMembersCursor(
  cursor: string | undefined,
  mode: 'membership' | 'search',
): WorkspaceAdministratorMembersCursor | undefined {
  if (!cursor) return undefined;

  try {
    const parsed = workspaceAdministratorMembersCursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (!parsed.success || parsed.data.mode !== mode) return undefined;
    if (parsed.data.mode === 'search') return parsed.data;

    const createdAt = new Date(parsed.data.createdAt);
    if (Number.isNaN(createdAt.getTime())) return undefined;
    return {
      mode: 'membership',
      cursor: {createdAt, id: parsed.data.id},
    };
  } catch {
    return undefined;
  }
}

function translateWorkspaceAdministratorMembersError(error: unknown): never {
  translateAdminRoleError(error, 'Administrator operator role required');
  if (error instanceof WorkspaceNotFoundError) {
    throw new ClientError('Workspace not found', 'workspace-not-found', {status: 404});
  }
  if (
    isInterModuleKnownError(
      authInterModuleContract.methods.listImpersonationEligibleUserSummaries,
      error,
    )
  ) {
    if (error.code === 'impersonation-disabled') {
      throw new ClientError('Impersonation is disabled', 'impersonation-disabled', {status: 403});
    }
    if (error.code === 'invalid-cursor') {
      throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
    }
  }
  throw error;
}

type WorkspaceAdministratorMembersResult = Awaited<
  ReturnType<typeof listWorkspaceAdministratorMembers>
>;

async function resolveWorkspaceAdministratorMembers(params: {
  workspaceId: string;
  auth: AuthInterModuleClient;
  query: WorkspaceAdminMembersQueryDto;
}): Promise<WorkspaceAdministratorMembersResult> {
  if ('user_id' in params.query) {
    return await listWorkspaceAdministratorMembers({
      workspaceId: params.workspaceId,
      auth: params.auth,
      limit: 1,
      userId: params.query.user_id,
    });
  }

  const decodedCursor = decodeWorkspaceAdministratorMembersCursor(
    params.query.cursor,
    params.query.search === undefined ? 'membership' : 'search',
  );
  if (params.query.cursor && !decodedCursor) {
    throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
  }

  return await listWorkspaceAdministratorMembers({
    workspaceId: params.workspaceId,
    auth: params.auth,
    limit: params.query.limit,
    ...(params.query.search === undefined ? {} : {search: params.query.search}),
    ...(decodedCursor === undefined ? {} : {cursor: decodedCursor}),
  });
}

function toWorkspaceAdministratorMembersResponse(result: WorkspaceAdministratorMembersResult) {
  return {
    workspace_id: result.workspace.id,
    workspace_slug: result.workspace.slug,
    workspace_name: result.workspace.name,
    workspace_status: result.workspace.status,
    members: result.members.map(toWorkspaceAdministratorMemberDto),
    next_cursor: result.nextCursor
      ? encodeWorkspaceAdministratorMembersCursor(result.nextCursor)
      : null,
  };
}

export function createAdminWorkspacesRoutes(params: {
  auth: AuthInterModuleClient;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
}): RouteGroup {
  const listRoute = defineRoute({
    method: 'GET',
    path: '/',
    description: 'List bounded safe workspace summaries for administrators.',
    auth: AUTH_USER,
    schema: {
      querystring: workspaceAdminLookupQuerySchema,
      response: {200: listWorkspaceAdminSummariesResponseSchema},
    },
    errorHandler: translateObserverAdministrationError,
    handler: async (request) => {
      const client = getUserContext(request);
      if (!client) {
        throw new ClientError('Authentication required', 'unauthorized', {status: 401});
      }
      await params.auth.requireAdminRole({
        userId: client.userId,
        minimumRole: 'admin-observer',
      });

      const {
        workspace_id: workspaceId,
        workspace_slug: workspaceSlug,
        search,
        status,
        limit,
        cursor,
      } = request.query;
      const decodedCursor = decodeStringIdCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const result = await listWorkspaceAdministratorSummaries({
        workspaceId,
        workspaceSlug,
        search,
        status,
        limit,
        cursor: decodedCursor,
        projects: params.projects,
        runners: params.runners,
      });

      return {
        workspaces: result.workspaces.map(toWorkspaceAdministratorSummaryDto),
        next_cursor: result.nextCursor ? encodeStringIdCursor(result.nextCursor) : null,
      };
    },
  });

  const createMutationRoute = (routeParams: {
    action: 'suspend' | 'reactivate';
    description: string;
    execute: (context: WorkspaceAdministrationMutationContext) => Promise<{
      workspaceId: string;
      status: 'active' | 'suspended';
      correlationId: string;
    }>;
  }) =>
    defineRoute({
      method: 'POST',
      path: `/:workspaceId/${routeParams.action}`,
      description: routeParams.description,
      auth: AUTH_USER,
      schema: {
        params: z.object({workspaceId: z.string().uuid()}),
        body: workspaceAdministrationMutationBodySchema,
        response: {200: workspaceAdministrationMutationResponseSchema},
      },
      errorHandler: translateAdministrationError,
      handler: async (request) => {
        const actorId = requireActorId(request);
        const actorRole = (
          await params.auth.requireAdminRole({userId: actorId, minimumRole: 'admin-operator'})
        ).role;
        return toWorkspaceAdministrationMutationDto(
          await routeParams.execute({
            actorId,
            actorRole,
            workspaceId: request.params.workspaceId,
            reason: request.body.reason,
            idempotencyKey: requireIdempotencyKey(request),
            correlationId: request.id,
          }),
        );
      },
    });

  const suspendRoute = createMutationRoute({
    action: 'suspend',
    description: 'Suspend a workspace for reversible administrator moderation.',
    execute: suspendWorkspace,
  });
  const reactivateRoute = createMutationRoute({
    action: 'reactivate',
    description: 'Reactivate a suspended workspace.',
    execute: reactivateWorkspace,
  });

  const memberRoute = defineRoute({
    method: 'GET',
    path: '/:workspaceId/members',
    description: 'List currently eligible impersonation targets for one workspace.',
    schema: {
      params: workspaceAdminMembersParamsSchema,
      querystring: workspaceAdminMembersQuerySchema,
      response: {200: listWorkspaceAdminMembersResponseSchema},
    },
    preHandler: [
      createWorkspaceAdminMembersRateLimitPreHandler(),
      (request) => {
        requireAdministrationActor(request);
        return undefined;
      },
    ],
    errorHandler: translateWorkspaceAdministratorMembersError,
    handler: async (request) => {
      const client = getUserContext(request);
      if (!client) {
        throw new ClientError('Authentication required', 'unauthorized', {status: 401});
      }
      await params.auth.requireAdminRole({
        userId: client.userId,
        minimumRole: 'admin-operator',
      });

      const result = await resolveWorkspaceAdministratorMembers({
        workspaceId: request.params.workspaceId,
        auth: params.auth,
        query: request.query,
      });

      return toWorkspaceAdministratorMembersResponse(result);
    },
  });

  const guardedRoutes = adoptAdministrationActorGuard({
    prefix: '/admin/workspaces',
    routes: [listRoute, suspendRoute, reactivateRoute],
  });

  return {
    prefix: '',
    routes: [
      guardedRoutes,
      {
        prefix: '/admin/workspaces',
        auth: AUTH_USER,
        routes: [memberRoute],
      },
    ],
  };
}
