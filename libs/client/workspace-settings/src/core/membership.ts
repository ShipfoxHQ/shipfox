export type WorkspaceMemberRole = 'admin';

export interface WorkspaceMember {
  id: string;
  userId: string;
  workspaceId: string;
  email: string;
  name: string | null;
  role: WorkspaceMemberRole;
  joinedAt: string;
  updatedAt: string;
}

export interface PendingInvitation {
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

export interface RevokeInvitationCommand {
  invitationId: string;
}

export interface RemoveWorkspaceMemberCommand {
  userId: string;
}

export type InvitationExpiry = 'active' | 'expires-soon' | 'expired';

export function getInvitationExpiry(
  invitation: Pick<PendingInvitation, 'expiresAt'>,
  now = Date.now(),
): InvitationExpiry {
  const expiresAt = Date.parse(invitation.expiresAt);
  if (expiresAt <= now) return 'expired';
  if (expiresAt - now < 24 * 60 * 60 * 1000) return 'expires-soon';
  return 'active';
}

export function memberCount(members: readonly WorkspaceMember[]): number {
  return members.length;
}

export type MemberRemovalRestriction = 'self' | 'last-member';

export function getMemberRemovalRestriction(params: {
  member: Pick<WorkspaceMember, 'userId'>;
  currentUserId: string | undefined;
  members: readonly WorkspaceMember[];
}): MemberRemovalRestriction | undefined {
  if (params.member.userId === params.currentUserId) return 'self';
  if (memberCount(params.members) <= 1) return 'last-member';
  return undefined;
}
