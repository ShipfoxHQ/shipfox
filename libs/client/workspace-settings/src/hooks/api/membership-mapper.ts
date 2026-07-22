import type {MembershipWithUserDto} from '@shipfox/api-workspaces-dto';
import type {WorkspaceMember} from '#core/membership.js';

export function toWorkspaceMember(dto: MembershipWithUserDto): WorkspaceMember {
  return {
    id: dto.id,
    userId: dto.user_id,
    workspaceId: dto.workspace_id,
    email: dto.user_email,
    name: dto.user_name,
    role: 'admin',
    joinedAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
