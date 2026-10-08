import {emailSchema} from '@shipfox/api-common-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {adminRoleSchema} from './schemas/admin.js';
import {jobLeaseTokenClaimsSchema} from './schemas/job-lease-token.js';
import {runnerSessionTokenClaimsSchema} from './schemas/runner-session-token.js';
import {userStatusSchema} from './schemas/user.js';

/** Maximum number of user IDs accepted by the batch eligibility lookup. */
export const IMPERSONATION_ELIGIBILITY_MAX_USER_IDS = 200;

/** Maximum number of identity candidates returned or scanned by one lookup page. */
export const IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE = 200;

const idSchema = z.string().uuid();
const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const SEARCH_TERM_SEPARATOR = /\s+/g;
const SEARCH_MAX_TERMS = 10;
const SEARCH_MAX_TERM_LENGTH = 100;
const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });
const searchSchema = z
  .string()
  .max(256)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  })
  .superRefine((value, context) => {
    const normalizedSearch = value.trim().replace(SEARCH_TERM_SEPARATOR, ' ');
    if (!normalizedSearch) {
      context.addIssue({code: 'custom', message: 'must not be blank'});
      return;
    }

    const terms = normalizedSearch.split(' ');
    if (terms.length > SEARCH_MAX_TERMS) {
      context.addIssue({code: 'custom', message: `accepts at most ${SEARCH_MAX_TERMS} terms`});
    }
    if (terms.some((term) => term.length > SEARCH_MAX_TERM_LENGTH)) {
      context.addIssue({
        code: 'custom',
        message: `terms must be at most ${SEARCH_MAX_TERM_LENGTH} characters`,
      });
    }
  })
  .optional();
const userSummaryInterModuleSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().optional(),
});
const administratorUserSummaryInterModuleSchema = z.object({
  id: idSchema,
  email: z.string().email(),
  name: z.string().nullable(),
  status: userStatusSchema,
  emailVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  adminRole: adminRoleSchema.nullable(),
});
const listImpersonationEligibleUserSummariesInputSchema = z
  .object({
    userIds: z.array(idSchema).max(IMPERSONATION_ELIGIBILITY_MAX_USER_IDS).optional(),
    search: searchSchema,
    cursor: cursorSchema.optional(),
    limit: z.number().int().min(1).max(IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE),
  })
  .superRefine((value, context) => {
    if (value.userIds === undefined && value.search === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'exactly one of userIds or search is required',
        path: ['search'],
      });
    }
    if (value.userIds !== undefined && value.search !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'userIds and search are mutually exclusive',
        path: ['search'],
      });
    }
    if (value.userIds !== undefined && value.cursor !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'userIds and cursor are mutually exclusive',
        path: ['cursor'],
      });
    }
  });

const impersonationIdempotencyKeySchema = z.string().trim().min(1).max(256);
const impersonationWindowInterModuleSchema = z.object({
  windowId: idSchema,
  workspaceId: idSchema,
  startedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
});
const impersonationWindowMutationInputSchema = z.object({
  actorId: idSchema,
  workspaceId: idSchema,
  idempotencyKey: impersonationIdempotencyKeySchema,
  correlationId: z.string().min(1).max(256),
});
const impersonationWindowClosedError = z.object({});
const impersonationRateLimitedError = z.object({retryAfterSeconds: z.number().int().min(0)});

const runnerSessionClaimsSchema = runnerSessionTokenClaimsSchema.omit({
  aud: true,
  iat: true,
  exp: true,
});
const jobLeaseClaimsSchema = jobLeaseTokenClaimsSchema.omit({aud: true, iat: true, exp: true});
const agentLogDownloadTokenIdSchema = z.string().uuid();
const agentLogDownloadAuthorityReasonSchema = z.enum([
  'grant-revoked',
  'user-inactive',
  'membership-revoked',
  'workspace-suspended',
  'workspace-deleted',
]);

export const authInterModuleContract = defineInterModuleContract({
  module: 'auth',
  methods: {
    mintRunnerSessionToken: {
      input: runnerSessionClaimsSchema,
      output: z.object({token: z.string().min(1)}),
    },
    mintJobLeaseToken: {
      input: jobLeaseClaimsSchema,
      output: z.object({token: z.string().min(1)}),
    },
    mintAgentLogDownloadToken: {
      input: z.object({
        userId: agentLogDownloadTokenIdSchema,
        workspaceId: agentLogDownloadTokenIdSchema,
        grantId: agentLogDownloadTokenIdSchema,
        clientId: z.string().min(1).max(2048),
        streamId: agentLogDownloadTokenIdSchema,
      }),
      output: z.object({token: z.string().min(1), expiresAt: z.string().datetime()}),
    },
    checkAgentGrantAuthority: {
      input: z.object({
        grantId: agentLogDownloadTokenIdSchema,
        userId: agentLogDownloadTokenIdSchema,
        workspaceId: agentLogDownloadTokenIdSchema,
      }),
      output: z.object({ok: z.literal(true)}),
      errors: {
        'authority-revoked': z.object({reason: agentLogDownloadAuthorityReasonSchema}),
      },
    },
    getUserSummary: {
      input: z.object({userId: idSchema}),
      output: userSummaryInterModuleSchema.optional(),
    },
    getUserSummaryByEmail: {
      input: z.object({email: emailSchema}),
      output: userSummaryInterModuleSchema.nullable(),
    },
    getCurrentAdminRole: {
      input: z.object({userId: z.string().uuid()}),
      output: z.object({role: adminRoleSchema.nullable()}),
    },
    requireAdminRole: {
      input: z.object({
        userId: z.string().uuid(),
        minimumRole: adminRoleSchema,
      }),
      output: z.object({role: adminRoleSchema}),
      errors: {
        'admin-role-required': z.object({requiredRole: adminRoleSchema}),
      },
    },
    /**
     * Lists safe users that can be impersonated. ID mode preserves the caller's
     * order; search mode uses a producer-owned opaque keyset cursor that is valid
     * only with the normalized search that produced it. This trusted internal
     * operation is not an authorization boundary; callers must authorize access
     * before passing identity data.
     */
    listImpersonationEligibleUserSummaries: {
      input: listImpersonationEligibleUserSummariesInputSchema,
      output: z.object({
        users: z
          .array(administratorUserSummaryInterModuleSchema)
          .max(IMPERSONATION_ELIGIBILITY_MAX_PAGE_SIZE),
        nextCursor: cursorSchema.nullable(),
      }),
      errors: {
        'impersonation-disabled': z.object({}),
        'invalid-cursor': z.object({}),
      },
    },
    /**
     * Opens an impersonation window for the actor on a workspace with the same
     * command as the browser route, or returns the actor's open window on that
     * workspace. The result is window metadata only; no token crosses the
     * boundary.
     */
    startImpersonationWindow: {
      input: impersonationWindowMutationInputSchema,
      output: impersonationWindowInterModuleSchema,
      errors: {
        'admin-role-required': z.object({requiredRole: adminRoleSchema}),
        'impersonation-disabled': z.object({}),
        'impersonation-workspace-not-active': z.object({}),
        'impersonation-window-limit-reached': z.object({}),
        'impersonation-window-closed': impersonationWindowClosedError,
        'idempotency-key-reused': z.object({}),
        'rate-limited': impersonationRateLimitedError,
      },
    },
    /** Ends the actor's open window on a workspace. */
    stopImpersonationWindow: {
      input: impersonationWindowMutationInputSchema,
      output: z.object({windowId: idSchema, endedAt: z.string().datetime()}),
      errors: {
        'admin-role-required': z.object({requiredRole: adminRoleSchema}),
        'impersonation-window-closed': impersonationWindowClosedError,
        'idempotency-key-reused': z.object({}),
        'rate-limited': impersonationRateLimitedError,
      },
    },
    /** Reads the actor's open window on a workspace, re-checking the actor's role. */
    findOpenImpersonationWindow: {
      input: z.object({actorId: idSchema, workspaceId: idSchema}),
      output: impersonationWindowInterModuleSchema,
      errors: {
        'admin-role-required': z.object({requiredRole: adminRoleSchema}),
        'impersonation-window-closed': impersonationWindowClosedError,
      },
    },
  },
});

export type UserSummaryInterModule = z.infer<typeof userSummaryInterModuleSchema>;
export type AdministratorUserSummaryInterModule = z.infer<
  typeof administratorUserSummaryInterModuleSchema
>;
export type ImpersonationWindowInterModule = z.infer<typeof impersonationWindowInterModuleSchema>;
export type ListImpersonationEligibleUserSummariesInput = z.infer<
  typeof listImpersonationEligibleUserSummariesInputSchema
>;

export type AuthInterModuleClient = InterModuleClient<typeof authInterModuleContract>;
