export interface EphemeralRegistrationToken {
  id: string;
  workspaceId: string;
  provisionerId: string;
  reservationId: string | null;
  provisionedRunnerId: string;
  hashedToken: string;
  prefix: string;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedSessionId: string | null;
  createdAt: Date;
}
