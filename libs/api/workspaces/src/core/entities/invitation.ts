export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  hashedToken: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
  invitedByUserId: string;
  invitedByDisplay: string | null;
  createdAt: Date;
  updatedAt: Date;
}
