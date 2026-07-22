import type {InvitationDto} from '@shipfox/api-workspaces-dto';
import type {PendingInvitation} from '#core/membership.js';

export function toInvitation(dto: InvitationDto): PendingInvitation {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    email: dto.email,
    expiresAt: dto.expires_at,
    acceptedAt: dto.accepted_at,
    invitedByUserId: dto.invited_by_user_id,
    invitedByDisplay: dto.invited_by_display,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
