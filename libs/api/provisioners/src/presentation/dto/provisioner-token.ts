import type {ProvisionerToken} from '#core/entities/provisioner-token.js';

export function toProvisionerTokenDto(token: ProvisionerToken): {
  id: string;
  workspace_id: string;
  prefix: string;
  name: string | null;
  created_by_user_id: string;
  revoked_by_user_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: token.id,
    workspace_id: token.workspaceId,
    prefix: token.prefix,
    name: token.name,
    created_by_user_id: token.createdByUserId,
    revoked_by_user_id: token.revokedByUserId,
    expires_at: token.expiresAt?.toISOString() ?? null,
    revoked_at: token.revokedAt?.toISOString() ?? null,
    created_at: token.createdAt.toISOString(),
    updated_at: token.updatedAt.toISOString(),
  };
}
