import type {AcceptInvitationResponseDto} from '@shipfox/api-workspaces-dto';
import type {InvitationAcceptance} from '#core/invitation-acceptance.js';

export function toInvitationAcceptance(dto: AcceptInvitationResponseDto): InvitationAcceptance {
  return {
    membership: {
      id: dto.membership.id,
      userId: dto.membership.user_id,
      workspaceId: dto.membership.workspace_id,
    },
    alreadyMember: dto.already_member,
  };
}
