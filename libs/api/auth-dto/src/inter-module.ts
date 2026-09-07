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
  .optional();
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

const runnerSessionClaimsSchema = runnerSessionTokenClaimsSchema.omit({
  aud: true,
  iat: true,
  exp: true,
});
const jobLeaseClaimsSchema = jobLeaseTokenClaimsSchema.omit({aud: true, iat: true, exp: true});

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
     * order; search mode uses a producer-owned opaque keyset cursor.
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
      },
    },
  },
});

export type AdministratorUserSummaryInterModule = z.infer<
  typeof administratorUserSummaryInterModuleSchema
>;
export type ListImpersonationEligibleUserSummariesInput = z.infer<
  typeof listImpersonationEligibleUserSummariesInputSchema
>;

export type AuthInterModuleClient = InterModuleClient<typeof authInterModuleContract>;
