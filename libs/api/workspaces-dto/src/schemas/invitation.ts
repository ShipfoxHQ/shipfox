import {emailSchema} from '@shipfox/api-common-dto';
import {z} from 'zod';

export const invitationDtoSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  email: z.string().email(),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  invited_by_user_id: z.string().uuid(),
  invited_by_display: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type InvitationDto = z.infer<typeof invitationDtoSchema>;

export const createInvitationBodySchema = z.object({
  email: emailSchema,
});

export type CreateInvitationBodyDto = z.infer<typeof createInvitationBodySchema>;

export const listInvitationsResponseSchema = z.object({
  invitations: z.array(invitationDtoSchema),
});

export type ListInvitationsResponseDto = z.infer<typeof listInvitationsResponseSchema>;

export const acceptInvitationBodySchema = z.object({
  token: z.string().min(1),
});

export type AcceptInvitationBodyDto = z.infer<typeof acceptInvitationBodySchema>;

export const acceptInvitationResponseSchema = z.object({
  membership: z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    workspace_id: z.string().uuid(),
  }),
  already_member: z.boolean(),
});

export type AcceptInvitationResponseDto = z.infer<typeof acceptInvitationResponseSchema>;

export const previewInvitationQuerySchema = z.object({
  token: z.string().min(1),
});

export type PreviewInvitationQueryDto = z.infer<typeof previewInvitationQuerySchema>;

const pendingPreviewSchema = z.object({
  status: z.literal('pending'),
  workspace_id: z.string().uuid(),
  workspace_name: z.string(),
  email: z.string(),
  invited_by_display: z.string().nullable(),
  expires_at: z.string(),
});

const expiredPreviewSchema = z.object({
  status: z.literal('expired'),
  workspace_name: z.string(),
  expires_at: z.string(),
});

const alreadyUsedPreviewSchema = z.object({
  status: z.literal('already_used'),
  workspace_name: z.string(),
});

const invalidPreviewSchema = z.object({
  status: z.literal('invalid'),
});

export const previewInvitationResponseSchema = z.discriminatedUnion('status', [
  pendingPreviewSchema,
  expiredPreviewSchema,
  alreadyUsedPreviewSchema,
  invalidPreviewSchema,
]);

export type PreviewInvitationResponseDto = z.infer<typeof previewInvitationResponseSchema>;
export type PreviewInvitationPendingDto = z.infer<typeof pendingPreviewSchema>;
