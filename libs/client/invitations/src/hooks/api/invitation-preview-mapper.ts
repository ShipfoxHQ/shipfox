import type {PreviewInvitationResponseDto} from '@shipfox/api-workspaces-dto';
import type {InvitationPreview} from '#core/invitation-preview.js';

export function toInvitationPreview(dto: PreviewInvitationResponseDto): InvitationPreview {
  switch (dto.status) {
    case 'pending':
      return {
        status: dto.status,
        workspaceId: dto.workspace_id,
        workspaceName: dto.workspace_name,
        email: dto.email,
        ...(dto.invited_by_display ? {invitedByDisplay: dto.invited_by_display} : {}),
        expiresAt: dto.expires_at,
      };
    case 'expired':
      return {status: dto.status, workspaceName: dto.workspace_name, expiresAt: dto.expires_at};
    case 'already_used':
      return {status: dto.status, workspaceName: dto.workspace_name};
    case 'invalid':
      return {status: dto.status};
  }
}
