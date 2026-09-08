import {
  authInterModuleContract,
  type ListImpersonationEligibleUserSummariesInput,
} from '@shipfox/api-auth-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import type {TimestampIdCursor} from '@shipfox/node-drizzle';
import {z} from 'zod';
import {getCurrentAdminRole, requireAdminRole} from '#core/admin-role.js';
import {listImpersonationEligibleUserSummaries} from '#core/administration.js';
import {AdminRoleRequiredError, ImpersonationDisabledError} from '#core/errors.js';
import {issueJobLeaseToken} from '#core/job-lease-token.js';
import {issueRunnerSessionToken} from '#core/runner-session-token.js';

const impersonationEligibilityCursorSchema = z.object({
  mode: z.literal('search'),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

function encodeImpersonationEligibilityCursor(cursor: TimestampIdCursor): string {
  return Buffer.from(
    JSON.stringify({
      mode: 'search',
      createdAt: cursor.createdAt.toISOString(),
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
    return {createdAt, id: parsed.data.id};
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

export function createAuthInterModulePresentation(): InterModulePresentation<
  typeof authInterModuleContract
> {
  return defineInterModulePresentation(authInterModuleContract, {
    mintRunnerSessionToken: async (claims) => ({token: await issueRunnerSessionToken(claims)}),
    mintJobLeaseToken: async (claims) => ({token: await issueJobLeaseToken(claims)}),
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
  });
}
