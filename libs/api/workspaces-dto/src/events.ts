import {z} from 'zod';

export const WORKSPACES_INVITATION_SEND_REQUESTED = 'workspaces.invitation.send_requested' as const;

export const workspacesInvitationSendRequestedSchema = z.object({
  email: z.string().email(),
  workspaceName: z.string(),
  inviterName: z.string(),
  inviteLink: z.string().url(),
});
export type WorkspacesInvitationSendRequestedEvent = z.infer<
  typeof workspacesInvitationSendRequestedSchema
>;

export interface WorkspacesEventMap {
  [WORKSPACES_INVITATION_SEND_REQUESTED]: WorkspacesInvitationSendRequestedEvent;
}

export const workspacesEventSchemas = {
  [WORKSPACES_INVITATION_SEND_REQUESTED]: workspacesInvitationSendRequestedSchema,
} satisfies Record<keyof WorkspacesEventMap, z.ZodType>;
