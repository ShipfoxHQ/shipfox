import type {ActiveProvisionerToken} from '#core/entities/provisioner-token.js';

export function toActiveProvisionerDto(token: ActiveProvisionerToken): {
  id: string;
  name: string | null;
  prefix: string;
  last_seen_at: string;
} {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    last_seen_at: token.lastSeenAt.toISOString(),
  };
}
