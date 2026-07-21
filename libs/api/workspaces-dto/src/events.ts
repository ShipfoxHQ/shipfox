import {z} from 'zod';

export const WORKSPACES_INVITATION_SEND_REQUESTED = 'workspaces.invitation.send_requested' as const;
export const WORKSPACES_WORKSPACE_CREATED = 'workspaces.workspace.created' as const;

export const workspacesInvitationSendRequestedSchema = z.object({
  email: z.string().email(),
  workspaceName: z.string(),
  inviterName: z.string(),
  inviteLink: z.string().url(),
});
export type WorkspacesInvitationSendRequestedEvent = z.infer<
  typeof workspacesInvitationSendRequestedSchema
>;

export const workspaceCreatedEventSchema = z.object({
  workspaceId: z.string().nonempty(),
  name: z.string().nonempty(),
  creatorUserId: z.string().nonempty(),
});
export type WorkspaceCreatedEvent = z.infer<typeof workspaceCreatedEventSchema>;

export interface WorkspacesEventMap {
  [WORKSPACES_INVITATION_SEND_REQUESTED]: WorkspacesInvitationSendRequestedEvent;
  [WORKSPACES_WORKSPACE_CREATED]: WorkspaceCreatedEvent;
}

export const workspacesEventSchemas = {
  [WORKSPACES_INVITATION_SEND_REQUESTED]: workspacesInvitationSendRequestedSchema,
  [WORKSPACES_WORKSPACE_CREATED]: workspaceCreatedEventSchema,
} satisfies Record<keyof WorkspacesEventMap, z.ZodType>;
