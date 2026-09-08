import {getUserContext} from '@shipfox/api-auth-context';
import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {enforceRateLimit as enforceSharedRateLimit} from '@shipfox/node-rate-limit';
import {
  checkWorkspacesRateLimit,
  WORKSPACE_ADMIN_MEMBERS_RATE_LIMIT,
  WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
} from '#core/rate-limit.js';

function routeName(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
}

function createWorkspaceRateLimitClientError(
  presentation: Parameters<
    NonNullable<Parameters<typeof enforceSharedRateLimit>[0]['createClientError']>
  >[0],
  cause: unknown,
): ClientError {
  return new ClientError(presentation.message, presentation.code, {
    status: presentation.status,
    ...(presentation.details ? {details: presentation.details} : {}),
    data: presentation.data,
    cause,
  });
}

async function enforceWorkspaceRateLimitScope(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  scope: 'ip' | 'actor';
  identifier: string;
  limit: number;
  windowSeconds: number;
  action: 'slug-availability' | 'workspace-admin-members';
}): Promise<void> {
  await enforceSharedRateLimit({
    request: params.request,
    reply: params.reply,
    check: () =>
      checkWorkspacesRateLimit({
        action: params.action,
        scope: params.scope,
        identifier: params.identifier,
        limit: params.limit,
        windowSeconds: params.windowSeconds,
      }),
    route: routeName(params.request),
    unavailableCode: 'workspace-rate-limit-unavailable',
    unavailableMessage: 'Workspace rate limiter unavailable',
    setRetryAfter: (reply, retryAfterSeconds) => {
      reply.header('Retry-After', String(retryAfterSeconds));
    },
    logWarn: (request, context) => {
      request.log.warn(context, 'Workspace rate limit blocked request');
    },
    logError: (request, context) => {
      request.log.error(context, 'Workspace rate limiter unavailable');
    },
    createClientError: createWorkspaceRateLimitClientError,
  });
}

export function createWorkspaceSlugAvailabilityRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await enforceWorkspaceRateLimitScope({
      request,
      reply,
      action: 'slug-availability',
      scope: 'ip',
      identifier: request.ip,
      ...WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
    });
  };
}

export function createWorkspaceAdminMembersRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await enforceWorkspaceRateLimitScope({
      request,
      reply,
      action: 'workspace-admin-members',
      scope: 'ip',
      identifier: request.ip,
      ...WORKSPACE_ADMIN_MEMBERS_RATE_LIMIT.ip,
    });

    const client = getUserContext(request);
    if (!client) return;

    await enforceWorkspaceRateLimitScope({
      request,
      reply,
      action: 'workspace-admin-members',
      scope: 'actor',
      identifier: client.userId,
      ...WORKSPACE_ADMIN_MEMBERS_RATE_LIMIT.actor,
    });
  };
}
