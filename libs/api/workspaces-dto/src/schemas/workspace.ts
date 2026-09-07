import {displayNameSchema, slugSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';

export const workspaceStatusSchema = z.enum(['active', 'suspended', 'deleted']);

export const WORKSPACE_ADMIN_MEMBERS_PAGE_SIZE_DEFAULT = 25;
export const WORKSPACE_ADMIN_MEMBERS_PAGE_SIZE_MAX = 25;
export const WORKSPACE_ADMIN_MEMBERS_SCAN_LIMIT = 200;

export const createWorkspaceBodySchema = z.object({
  name: displayNameSchema,
  slug: slugSchema,
});

export type CreateWorkspaceBodyDto = z.infer<typeof createWorkspaceBodySchema>;

export const updateWorkspaceBodySchema = z
  .object({
    name: displayNameSchema.optional(),
    slug: slugSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.slug !== undefined, {
    message: 'At least one of name or slug is required',
  });

export type UpdateWorkspaceBodyDto = z.infer<typeof updateWorkspaceBodySchema>;

export const workspaceSlugAvailabilityQuerySchema = z.object({
  slug: slugSchema,
});

export type WorkspaceSlugAvailabilityQueryDto = z.infer<
  typeof workspaceSlugAvailabilityQuerySchema
>;

export const workspaceSlugAvailabilityResponseSchema = z.object({
  available: z.boolean(),
});

export type WorkspaceSlugAvailabilityResponseDto = z.infer<
  typeof workspaceSlugAvailabilityResponseSchema
>;

export const workspaceDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: slugSchema,
  status: workspaceStatusSchema,
  settings: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;

export const workspaceResponseSchema = workspaceDtoSchema;

export type WorkspaceResponseDto = z.infer<typeof workspaceResponseSchema>;

export const workspaceAdminLookupQuerySchema = z
  .object({
    workspace_id: z.string().uuid().optional(),
    workspace_slug: slugSchema.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    status: workspaceStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.workspace_slug === undefined) return;

    const conflictingFields = ['workspace_id', 'search', 'cursor'] as const;
    if (conflictingFields.some((field) => value[field] !== undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'workspace_slug cannot be combined with workspace_id, search, or cursor',
        path: ['workspace_slug'],
      });
    }
  });

export type WorkspaceAdminLookupQueryDto = z.infer<typeof workspaceAdminLookupQuerySchema>;

const CONTROL_OR_FORMAT_CHARACTER_RE = /[\p{Cc}\p{Cf}]/u;
const DIGITS_RE = /^\d+$/u;
const workspaceAdministrationReasonSchema = z
  .string()
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  })
  .transform((value) => value.trim())
  .pipe(z.string().min(1).max(512));

export const workspaceAdministrationMutationBodySchema = z.object({
  reason: workspaceAdministrationReasonSchema,
});

export type WorkspaceAdministrationMutationBodyDto = z.infer<
  typeof workspaceAdministrationMutationBodySchema
>;

export const workspaceAdministrationMutationResponseSchema = z.object({
  workspace_id: z.string().uuid(),
  status: workspaceStatusSchema,
  correlation_id: z.string().min(1),
});

export type WorkspaceAdministrationMutationResponseDto = z.infer<
  typeof workspaceAdministrationMutationResponseSchema
>;

export const workspaceAdminMemberSummarySchema = z.object({
  count: z.number().int().nonnegative(),
});

export const workspaceAdminProjectSummarySchema = z.discriminatedUnion('state', [
  z.object({state: z.literal('available'), count: z.number().int().nonnegative()}),
  z.object({state: z.literal('unknown')}),
]);

export const workspaceAdminJobCountsSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('available'),
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
  }),
  z.object({state: z.literal('unknown')}),
]);

export const workspaceAdminSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: slugSchema,
  status: workspaceStatusSchema,
  member_summary: workspaceAdminMemberSummarySchema,
  project_summary: workspaceAdminProjectSummarySchema,
  job_counts: workspaceAdminJobCountsSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type WorkspaceAdminSummaryDto = z.infer<typeof workspaceAdminSummarySchema>;

export const listWorkspaceAdminSummariesResponseSchema = z.object({
  workspaces: z.array(workspaceAdminSummarySchema),
  next_cursor: z.string().nullable(),
});

export type ListWorkspaceAdminSummariesResponseDto = z.infer<
  typeof listWorkspaceAdminSummariesResponseSchema
>;

const workspaceAdminMemberStatusSchema = z.enum(['active', 'suspended', 'deleted']);
const workspaceAdminMemberRoleSchema = z
  .enum(['admin-observer', 'admin-operator', 'admin-owner'])
  .nullable();
const workspaceAdminMemberCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
    message: 'must not contain control or format characters',
  });
const workspaceAdminMemberSearchSchema = z
  .string()
  .max(256)
  .optional()
  .transform((value) => {
    if (
      typeof value === 'string' &&
      !CONTROL_OR_FORMAT_CHARACTER_RE.test(value) &&
      value.trim().length === 0
    ) {
      return undefined;
    }

    return value;
  })
  .pipe(
    z
      .string()
      .refine((value) => !CONTROL_OR_FORMAT_CHARACTER_RE.test(value), {
        message: 'must not contain control or format characters',
      })
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1)
          .refine((value) => hasAtMostCodePoints(value, 128), {
            message: 'String must contain at most 128 character(s)',
          }),
      )
      .optional(),
  );
const workspaceAdminMemberLimitSchema = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && DIGITS_RE.test(value)) return Number(value);
  return value;
}, z.number().int().min(1).max(WORKSPACE_ADMIN_MEMBERS_PAGE_SIZE_MAX));

function hasAtMostCodePoints(value: string, maxLength: number): boolean {
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
    if (length > maxLength) return false;
  }

  return true;
}

export const workspaceAdminMembersParamsSchema = z
  .object({workspaceId: z.string().uuid()})
  .strict();

export type WorkspaceAdminMembersParamsDto = z.infer<typeof workspaceAdminMembersParamsSchema>;

const exactWorkspaceAdminMembersQuerySchema = z.object({user_id: z.string().uuid()}).strict();
const paginatedWorkspaceAdminMembersQuerySchema = z
  .object({
    search: workspaceAdminMemberSearchSchema,
    cursor: workspaceAdminMemberCursorSchema.optional(),
    limit: workspaceAdminMemberLimitSchema.default(WORKSPACE_ADMIN_MEMBERS_PAGE_SIZE_DEFAULT),
  })
  .strict();

export const workspaceAdminMembersQuerySchema = z.union([
  exactWorkspaceAdminMembersQuerySchema,
  paginatedWorkspaceAdminMembersQuerySchema,
]);

export type WorkspaceAdminMembersQueryDto = z.infer<typeof workspaceAdminMembersQuerySchema>;

export const workspaceAdminMemberSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  status: workspaceAdminMemberStatusSchema,
  email_verified_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  admin_role: workspaceAdminMemberRoleSchema,
});

export type WorkspaceAdminMemberDto = z.infer<typeof workspaceAdminMemberSchema>;

const workspaceAdminMembersResponseBaseSchema = z.object({
  workspace_id: z.string().uuid(),
  workspace_slug: slugSchema,
  workspace_name: z.string(),
  workspace_status: workspaceStatusSchema,
  members: z.array(workspaceAdminMemberSchema).max(WORKSPACE_ADMIN_MEMBERS_PAGE_SIZE_MAX),
  next_cursor: workspaceAdminMemberCursorSchema.nullable(),
});

export const listWorkspaceAdminMembersResponseSchema =
  workspaceAdminMembersResponseBaseSchema.superRefine((value, context) => {
    if (value.workspace_status === 'active') return;
    if (value.members.length === 0 && value.next_cursor === null) return;

    context.addIssue({
      code: 'custom',
      message: 'inactive workspaces cannot return members or a next cursor',
      path: ['members'],
    });
  });

export type ListWorkspaceAdminMembersResponseDto = z.infer<
  typeof listWorkspaceAdminMembersResponseSchema
>;

export const workspaceAdminMembersResponseSchema = listWorkspaceAdminMembersResponseSchema;

export type WorkspaceAdminMembersResponseDto = ListWorkspaceAdminMembersResponseDto;
