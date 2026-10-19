import {slugSchema} from '@shipfox/api-common-dto';
import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {workspaceRoleSchema} from '#schemas/membership.js';
import {workspaceStatusSchema} from '#schemas/workspace.js';

const idSchema = z.string().uuid();
const workspaceSummaryInterModuleSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: slugSchema,
});
const adminWorkspaceSchema = z.object({
  id: idSchema,
  name: z.string(),
  slug: slugSchema,
  status: workspaceStatusSchema,
  memberCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const adminWorkspaceCursorSchema = z.object({value: z.string().min(1), id: idSchema});

export const workspacesInterModuleContract = defineInterModuleContract({
  module: 'workspaces',
  methods: {
    listMembershipsForTokenClaims: {
      input: z.object({userId: idSchema}),
      output: z.object({
        memberships: z.array(
          z.object({
            workspaceId: idSchema,
            workspaceSlug: slugSchema,
            role: workspaceRoleSchema,
            workspaceStatus: workspaceStatusSchema.default('active'),
          }),
        ),
      }),
    },
    /**
     * Lists workspaces across the platform for administrator surfaces, ordered
     * by name. Callers check the administrator role before calling.
     */
    listAdminWorkspaces: {
      input: z.object({
        workspaceId: idSchema.optional(),
        search: z.string().min(1).max(100).optional(),
        status: workspaceStatusSchema.optional(),
        limit: z.number().int().min(1).max(100),
        cursor: adminWorkspaceCursorSchema.optional(),
      }),
      output: z.object({
        workspaces: z.array(adminWorkspaceSchema),
        nextCursor: adminWorkspaceCursorSchema.nullable(),
      }),
    },
    /** Resolves the user id that created the workspace, or null when no creator was recorded. */
    getWorkspaceSummary: {
      input: z.object({workspaceId: idSchema}),
      output: workspaceSummaryInterModuleSchema.optional(),
    },
    getWorkspaceCreator: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({creatorUserId: idSchema.nullable()}),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
      },
    },
    /** Returns only the current workspace operating state needed by admission owners. */
    getWorkspaceOperatingState: {
      input: z.object({workspaceId: idSchema}),
      output: z.object({status: workspaceStatusSchema}),
      errors: {
        'workspace-not-found': z.object({workspaceId: idSchema}),
      },
    },
    preflightInvitationAcceptance: {
      input: z.object({token: z.string().min(1), email: z.string().email()}),
      output: z.object({}),
      errors: {
        'invitation-token-invalid': z.object({}),
        'invitation-token-used': z.object({}),
        'invitation-token-expired': z.object({}),
        'invitation-email-mismatch': z.object({}),
      },
    },
    acceptInvitation: {
      input: z.object({
        token: z.string().min(1),
        userId: idSchema,
        email: z.string().email(),
        name: z.string().nullable().optional(),
      }),
      output: z.object({
        membership: z.object({id: idSchema, userId: idSchema, workspaceId: idSchema}),
      }),
      errors: {
        'invitation-token-invalid': z.object({}),
        'invitation-token-used': z.object({}),
        'invitation-token-expired': z.object({}),
        'invitation-email-mismatch': z.object({}),
        'workspace-membership-cap-exceeded': z.object({cap: z.number().int().positive()}),
      },
    },
    requireActiveMembership: {
      input: z.object({
        workspaceId: idSchema,
        userId: idSchema,
        memberships: z.array(
          z.object({
            workspaceId: idSchema,
            workspaceSlug: slugSchema.optional(),
            role: workspaceRoleSchema,
            workspaceStatus: workspaceStatusSchema.default('active'),
          }),
        ),
      }),
      output: z.object({}),
      errors: {
        'membership-required': z.object({workspaceId: idSchema}),
        'workspace-not-found': z.object({workspaceId: idSchema}),
        'workspace-inactive': z.object({workspaceId: idSchema}),
      },
    },
  },
});

export type WorkspaceSummaryInterModule = z.infer<typeof workspaceSummaryInterModuleSchema>;

export type WorkspacesInterModuleClient = InterModuleClient<typeof workspacesInterModuleContract>;
