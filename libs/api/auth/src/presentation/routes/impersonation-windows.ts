import {AUTH_USER, requireAdministrationActor} from '@shipfox/api-auth-context';
import {
  impersonationWindowContinueBodySchema,
  impersonationWindowContinueParamsSchema,
  impersonationWindowContinueResponseSchema,
  impersonationWindowExactReadParamsSchema,
  impersonationWindowExactResponseSchema,
  impersonationWindowStartBodySchema,
  impersonationWindowStartResponseSchema,
  impersonationWindowStopBodySchema,
  impersonationWindowStopParamsSchema,
  impersonationWindowStopResponseSchema,
  impersonationWindowsQuerySchema,
  impersonationWindowsResponseSchema,
} from '@shipfox/api-auth-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  continueImpersonationWindow,
  getImpersonationWindow,
  listImpersonationWindows,
  startImpersonationWindow,
  stopImpersonationWindow,
} from '#core/administration.js';
import {toUserDto} from '../dto/user.js';
import {
  requireActorId,
  requireIdempotencyKey,
  toAdministratorUserSummaryDto,
  translateAdministrationError,
} from './administration.js';
import {createAuthActorRateLimitPreHandler} from './rate-limit.js';

const errorResponseSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

const mutationErrorResponses = {
  400: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  410: errorResponseSchema,
  429: errorResponseSchema,
};

const readErrorResponses = {
  400: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
};

function administrationActorGuard(
  request: Parameters<typeof requireAdministrationActor>[0],
): undefined {
  requireAdministrationActor(request);
  return undefined;
}

function toWindowTokenResponse(result: Awaited<ReturnType<typeof startImpersonationWindow>>) {
  return {
    token: result.token,
    expires_at: result.expiresAt.toISOString(),
    server_time: result.serverTime.toISOString(),
    impersonator_id: result.impersonatorId,
    user: toUserDto(result.user),
    window_id: result.windowId,
    window_started_at: result.windowStartedAt.toISOString(),
    window_deadline: result.windowDeadline.toISOString(),
  };
}

function toWindowSummaryResponse(view: Awaited<ReturnType<typeof getImpersonationWindow>>) {
  return {
    window_id: view.windowId,
    actor: toAdministratorUserSummaryDto(view.actor),
    target: toAdministratorUserSummaryDto(view.target),
    reason: view.reason,
    started_at: view.startedAt.toISOString(),
    deadline_at: view.deadlineAt.toISOString(),
  };
}

function toWindowExactResponse(view: Awaited<ReturnType<typeof getImpersonationWindow>>) {
  return {
    ...toWindowSummaryResponse(view),
    state: view.state,
    ended_at: view.endedAt?.toISOString() ?? null,
    ended_reason: view.endedReason,
  };
}

export function createImpersonationWindowRoutes(
  workspaces: WorkspacesInterModuleClient,
): RouteGroup {
  const startRoute = defineRoute({
    method: 'POST',
    path: '/',
    description: 'Open an audited impersonation window and mint its first short-lived token.',
    schema: {
      body: impersonationWindowStartBodySchema,
      response: {200: impersonationWindowStartResponseSchema, ...mutationErrorResponses},
    },
    preHandler: [createAuthActorRateLimitPreHandler('impersonate'), administrationActorGuard],
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const result = await startImpersonationWindow({
        actorId: requireActorId(request),
        targetUserId: request.body.target_user_id,
        reason: request.body.reason,
        ...(request.body.required_workspace_id
          ? {requiredWorkspaceId: request.body.required_workspace_id}
          : {}),
        idempotencyKey: requireIdempotencyKey(request),
        correlationId: crypto.randomUUID(),
        workspaces,
      });
      return toWindowTokenResponse(result);
    },
  });

  const continueRoute = defineRoute({
    method: 'POST',
    path: '/:windowId/continue',
    description: 'Re-authorize and mint another token inside an open impersonation window.',
    schema: {
      params: impersonationWindowContinueParamsSchema,
      body: impersonationWindowContinueBodySchema,
      response: {200: impersonationWindowContinueResponseSchema, ...mutationErrorResponses},
    },
    preHandler: [
      createAuthActorRateLimitPreHandler('impersonate-continue'),
      administrationActorGuard,
    ],
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const result = await continueImpersonationWindow({
        actorId: requireActorId(request),
        windowId: request.params.windowId,
        idempotencyKey: requireIdempotencyKey(request),
        correlationId: crypto.randomUUID(),
        workspaces,
      });
      return toWindowTokenResponse(result);
    },
  });

  const stopRoute = defineRoute({
    method: 'POST',
    path: '/:windowId/stop',
    description: 'End an impersonation window and reduce authority without minting a token.',
    schema: {
      params: impersonationWindowStopParamsSchema,
      body: impersonationWindowStopBodySchema,
      response: {200: impersonationWindowStopResponseSchema, ...mutationErrorResponses},
    },
    preHandler: [createAuthActorRateLimitPreHandler('impersonate-stop'), administrationActorGuard],
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const result = await stopImpersonationWindow({
        actorId: requireActorId(request),
        windowId: request.params.windowId,
        ...(request.body.reason ? {reason: request.body.reason} : {}),
        idempotencyKey: requireIdempotencyKey(request),
        correlationId: crypto.randomUUID(),
      });
      return {
        window_id: result.windowId,
        state: result.state,
        ended_at: result.endedAt.toISOString(),
      };
    },
  });

  const collectionReadRoute = defineRoute({
    method: 'GET',
    path: '/',
    description: 'List open impersonation windows owned by the actor or all windows for an owner.',
    schema: {
      querystring: impersonationWindowsQuerySchema,
      response: {200: impersonationWindowsResponseSchema, ...readErrorResponses},
    },
    preHandler: [
      createAuthActorRateLimitPreHandler('impersonation-windows'),
      administrationActorGuard,
    ],
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const decodedCursor = decodeTimestampIdCursor(request.query.cursor);
      if (request.query.cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }
      const result = await listImpersonationWindows({
        actorId: requireActorId(request),
        scope: request.query.scope,
        limit: request.query.limit,
        ...(decodedCursor ? {cursor: decodedCursor} : {}),
      });
      return {
        windows: result.rows.map(toWindowSummaryResponse),
        next_cursor: result.nextCursor ? encodeTimestampIdCursor(result.nextCursor) : null,
      };
    },
  });

  const exactReadRoute = defineRoute({
    method: 'GET',
    path: '/:windowId',
    description: 'Read safe metadata and the effective state of one impersonation window.',
    schema: {
      params: impersonationWindowExactReadParamsSchema,
      response: {200: impersonationWindowExactResponseSchema, ...readErrorResponses},
    },
    preHandler: [
      createAuthActorRateLimitPreHandler('impersonation-windows'),
      administrationActorGuard,
    ],
    errorHandler: translateAdministrationError,
    handler: async (request) => {
      const result = await getImpersonationWindow({
        actorId: requireActorId(request),
        windowId: request.params.windowId,
      });
      return toWindowExactResponse(result);
    },
  });

  return {
    prefix: '/admin/auth/impersonation/windows',
    auth: AUTH_USER,
    routes: [startRoute, continueRoute, stopRoute, collectionReadRoute, exactReadRoute],
  };
}
