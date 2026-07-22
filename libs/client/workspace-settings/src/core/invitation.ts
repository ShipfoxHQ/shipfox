export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  invitedByUserId: string;
  invitedByDisplay: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInvitationCommand {
  email: string;
}
