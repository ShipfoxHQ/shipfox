import {formatDate, formatTimestamp} from '@shipfox/react-ui/utils';

export function formatProvisionerTokenDate(value: string | null): string {
  if (!value) return 'Never';
  return formatDate(value);
}

export function formatProvisionerTokenTimestamp(value: string | null): string | undefined {
  if (!value) return undefined;
  return formatTimestamp(value);
}
