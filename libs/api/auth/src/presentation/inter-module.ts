import {
  authInterModuleContract,
  type ListImpersonationEligibleUserSummariesInput,
} from '@shipfox/api-auth-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  createTimestampIdCursor,
  type TimestampIdCursor,
  timestampIdCursorTimestamp,
} from '@shipfox/node-drizzle';
import {z} from 'zod';
import {getCurrentAdminRole, requireAdminRole} from '#core/admin-role.js';
import {
  findActorOpenImpersonationWindow,
  listImpersonationEligibleUserSummaries,
  startWorkspaceImpersonationWindow,
  stopActorImpersonationWindow,
} from '#core/administration.js';
import {checkAgentGrantAuthority} from '#core/agent-grant-authority.js';
import {mintAgentLogDownloadToken} from '#core/agent-log-download-token.js';
import {
  AdminIdempotencyKeyReuseError,
  AdminRoleRequiredError,
  AgentGrantAuthorityRevokedError,
  ImpersonationDisabledError,
  ImpersonationWindowDeadlineReachedError,
  ImpersonationWindowLimitReachedError,
  ImpersonationWindowNotFoundError,
  ImpersonationWindowStoppedError,
  ImpersonationWorkspaceNotActiveError,
} from '#core/errors.js';
import {issueJobLeaseToken} from '#core/job-lease-token.js';
import {AuthRateLimitExceededError, checkAuthRateLimit} from '#core/rate-limit.js';
import {issueRunnerSessionToken} from '#core/runner-session-token.js';
import {getUserSummary, getUserSummaryByEmail} from '#core/user-summary.js';
import {authRateLimitPolicies} from './routes/rate-limit.js';

const impersonationEligibilityCursorSchema = z.object({
  mode: z.literal('search'),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

function encodeImpersonationEligibilityCursor(cursor: TimestampIdCursor): string {
  return Buffer.from(
    JSON.stringify({
      mode: 'search',
      createdAt: timestampIdCursorTimestamp(cursor),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeImpersonationEligibilityCursor(cursor: string): TimestampIdCursor | undefined {
  try {
    const parsed = impersonationEligibilityCursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (!parsed.success) return undefined;
    const createdAt = new Date(parsed.data.createdAt);
    if (Number.isNaN(createdAt.getTime())) return undefined;
    return createTimestampIdCursor({createdAt: parsed.data.createdAt, id: parsed.data.id});
  } catch {
    return undefined;
  }
}

function toAdministratorUserSummaryInterModule(user: {
  id: string;
  email: string;
  name: string | null;
  status: 'active' | 'suspended' | 'deleted';
  emailVerifiedAt: Date | null;
  createdAt: Date;
  adminRole: 'admin-observer' | 'admin-operator' | 'admin-owner' | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    adminRole: user.adminRole,
  };
}

async function listImpersonationEligibleUserSummariesPresentation(
  input: ListImpersonationEligibleUserSummariesInput,
) {
  const method = authInterModuleContract.methods.listImpersonationEligibleUserSummaries;
  const decodedCursor =
    input.cursor === undefined ? undefined : decodeImpersonationEligibilityCursor(input.cursor);
  if (input.cursor !== undefined && decodedCursor === undefined) {
    throw createInterModuleKnownError(method, 'invalid-cursor', {});
  }

  try {
    const result = await listImpersonationEligibleUserSummaries({
      limit: input.limit,
      ...(input.userIds !== undefined ? {userIds: input.userIds} : {}),
      ...(input.search !== undefined ? {search: input.search} : {}),
      ...(decodedCursor !== undefined ? {cursor: decodedCursor} : {}),
    });
    return {
      users: result.users.map(toAdministratorUserSummaryInterModule),
      nextCursor: result.nextCursor
        ? encodeImpersonationEligibilityCursor(result.nextCursor)
        : null,
    };
  } catch (error) {
    if (error instanceof ImpersonationDisabledError) {
      throw createInterModuleKnownError(method, 'impersonation-disabled', {});
    }
    throw error;
  }
}

type WindowMethodInput<Name extends keyof typeof authInterModuleContract.methods> = z.infer<
  (typeof authInterModuleContract.methods)[Name]['input']
>;

function isWindowClosedError(error: unknown): boolean {
  return (
    error instanceof ImpersonationWindowNotFoundError ||
    error instanceof ImpersonationWindowStoppedError ||
    error instanceof ImpersonationWindowDeadlineReachedError
  );
}

/** Applies the actor bucket of the same rate limit the browser route uses. */
async function enforceActorRateLimit(
  action: 'impersonate' | 'impersonate-stop',
  actorId: string,
): Promise<void> {
  const policy = authRateLimitPolicies[action].actor;
  if (!policy) return;
  await checkAuthRateLimit({action, scope: 'actor', identifier: actorId, ...policy});
}

async function startImpersonationWindowPresentation(
  input: WindowMethodInput<'startImpersonationWindow'>,
  workspaces: WorkspacesInterModuleClient,
) {
  const method = authInterModuleContract.methods.startImpersonationWindow;
  try {
    await enforceActorRateLimit('impersonate', input.actorId);
    const window = await startWorkspaceImpersonationWindow({...input, workspaces});
    return {
      windowId: window.windowId,
      workspaceId: window.workspaceId,
      startedAt: window.startedAt.toISOString(),
      deadlineAt: window.deadlineAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof AuthRateLimitExceededError) {
      throw createInterModuleKnownError(method, 'rate-limited', {
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    if (error instanceof AdminRoleRequiredError) {
      throw createInterModuleKnownError(method, 'admin-role-required', {
        requiredRole: error.minimumRole,
      });
    }
    if (error instanceof ImpersonationDisabledError) {
      throw createInterModuleKnownError(method, 'impersonation-disabled', {});
    }
    if (error instanceof ImpersonationWorkspaceNotActiveError) {
      throw createInterModuleKnownError(method, 'impersonation-workspace-not-active', {});
    }
    if (error instanceof ImpersonationWindowLimitReachedError) {
      throw createInterModuleKnownError(method, 'impersonation-window-limit-reached', {});
    }
    if (error instanceof AdminIdempotencyKeyReuseError) {
      throw createInterModuleKnownError(method, 'idempotency-key-reused', {});
    }
    if (isWindowClosedError(error)) {
      throw createInterModuleKnownError(method, 'impersonation-window-closed', {});
    }
    throw error;
  }
}

async function stopImpersonationWindowPresentation(
  input: WindowMethodInput<'stopImpersonationWindow'>,
) {
  const method = authInterModuleContract.methods.stopImpersonationWindow;
  try {
    await enforceActorRateLimit('impersonate-stop', input.actorId);
    const result = await stopActorImpersonationWindow(input);
    return {windowId: result.windowId, endedAt: result.endedAt.toISOString()};
  } catch (error) {
    if (error instanceof AuthRateLimitExceededError) {
      throw createInterModuleKnownError(method, 'rate-limited', {
        retryAfterSeconds: error.retryAfterSeconds,
      });
    }
    if (error instanceof AdminRoleRequiredError) {
      throw createInterModuleKnownError(method, 'admin-role-required', {
        requiredRole: error.minimumRole,
      });
    }
    if (error instanceof AdminIdempotencyKeyReuseError) {
      throw createInterModuleKnownError(method, 'idempotency-key-reused', {});
    }
    if (isWindowClosedError(error)) {
      throw createInterModuleKnownError(method, 'impersonation-window-closed', {});
    }
    throw error;
  }
}

async function findOpenImpersonationWindowPresentation(
  input: WindowMethodInput<'findOpenImpersonationWindow'>,
) {
  const method = authInterModuleContract.methods.findOpenImpersonationWindow;
  try {
    const window = await findActorOpenImpersonationWindow(input);
    if (!window) throw createInterModuleKnownError(method, 'impersonation-window-closed', {});
    return {
      windowId: window.id,
      workspaceId: input.workspaceId,
      startedAt: window.startedAt.toISOString(),
      deadlineAt: window.deadlineAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof AdminRoleRequiredError) {
      throw createInterModuleKnownError(method, 'admin-role-required', {
        requiredRole: error.minimumRole,
      });
    }
    throw error;
  }
}

export function createAuthInterModulePresentation(
  workspaces: WorkspacesInterModuleClient,
): InterModulePresentation<typeof authInterModuleContract> {
  return defineInterModulePresentation(authInterModuleContract, {
    mintRunnerSessionToken: async (claims) => ({token: await issueRunnerSessionToken(claims)}),
    mintJobLeaseToken: async (claims) => ({token: await issueJobLeaseToken(claims)}),
    mintAgentLogDownloadToken: async (claims) => {
      const result = await mintAgentLogDownloadToken({
        sub: claims.userId,
        workspaceId: claims.workspaceId,
        grantId: claims.grantId,
        clientId: claims.clientId,
        streamId: claims.streamId,
      });
      return {token: result.token, expiresAt: result.expiresAt.toISOString()};
    },
    checkAgentGrantAuthority: async (input) => {
      try {
        return await checkAgentGrantAuthority({...input, workspaces});
      } catch (error) {
        if (error instanceof AgentGrantAuthorityRevokedError) {
          throw createInterModuleKnownError(
            authInterModuleContract.methods.checkAgentGrantAuthority,
            'authority-revoked',
            {reason: error.reason},
          );
        }
        throw error;
      }
    },
    getUserSummary: async ({userId}) => {
      const user = await getUserSummary({userId});
      if (!user) return undefined;
      return {
        id: user.id,
        email: user.email,
        ...(user.name === null ? {} : {name: user.name}),
      };
    },
    getUserSummaryByEmail: async ({email}) => {
      const user = await getUserSummaryByEmail({email});
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        ...(user.name === null ? {} : {name: user.name}),
      };
    },
    getCurrentAdminRole: async ({userId}) => ({role: await getCurrentAdminRole({userId})}),
    requireAdminRole: async ({userId, minimumRole}) => {
      try {
        return {role: await requireAdminRole({userId, minimumRole})};
      } catch (error) {
        if (error instanceof AdminRoleRequiredError) {
          throw createInterModuleKnownError(
            authInterModuleContract.methods.requireAdminRole,
            'admin-role-required',
            {requiredRole: error.minimumRole},
          );
        }
        throw error;
      }
    },
    listImpersonationEligibleUserSummaries: listImpersonationEligibleUserSummariesPresentation,
    startImpersonationWindow: (input) => startImpersonationWindowPresentation(input, workspaces),
    stopImpersonationWindow: stopImpersonationWindowPresentation,
    findOpenImpersonationWindow: findOpenImpersonationWindowPresentation,
  });
}
