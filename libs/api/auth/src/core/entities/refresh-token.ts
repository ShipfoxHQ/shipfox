export interface RefreshToken {
  id: string;
  sessionId: string;
  userId: string;
  hashedToken: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
