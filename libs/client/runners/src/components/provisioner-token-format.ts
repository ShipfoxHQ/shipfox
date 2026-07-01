import type {ProvisionerTokenDto} from '@shipfox/api-runners-dto';
import type {DotVariant} from '@shipfox/react-ui';
import {formatDate, formatTimestamp} from '@shipfox/react-ui';

export type ProvisionerConnectionStatus =
  | {kind: 'connected'; dotVariant: DotVariant; label: 'Connected'}
  | {kind: 'last-seen'; dotVariant: DotVariant; label: 'Last seen'; lastSeenAt: string}
  | {kind: 'never-connected'; dotVariant: DotVariant; label: 'Never connected'};

export function formatProvisionerTokenDate(value: string | null): string {
  if (!value) return 'Never';
  return formatDate(value);
}

export function formatProvisionerTokenTimestamp(value: string | null): string | undefined {
  if (!value) return undefined;
  return formatTimestamp(value);
}

export function provisionerTokenDisplayName(token: Pick<ProvisionerTokenDto, 'name'>): string {
  return token.name || 'Unnamed provisioner';
}

export function provisionerConnectionStatus(
  token: Pick<ProvisionerTokenDto, 'id' | 'last_seen_at'>,
  activeIds: ReadonlySet<string>,
): ProvisionerConnectionStatus {
  if (activeIds.has(token.id)) {
    return {kind: 'connected', dotVariant: 'success', label: 'Connected'};
  }
  if (token.last_seen_at) {
    return {
      kind: 'last-seen',
      dotVariant: 'neutral',
      label: 'Last seen',
      lastSeenAt: token.last_seen_at,
    };
  }
  return {kind: 'never-connected', dotVariant: 'neutral', label: 'Never connected'};
}
