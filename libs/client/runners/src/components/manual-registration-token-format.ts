import type {ManualRegistrationTokenDto} from '@shipfox/api-runners-dto';
import {formatDate, formatTimestamp} from '@shipfox/react-ui/utils';

export function formatManualRegistrationTokenDate(value: string | null): string {
  if (!value) return 'Never';
  return formatDate(value);
}

export function formatManualRegistrationTokenTimestamp(value: string | null): string | undefined {
  if (!value) return undefined;
  return formatTimestamp(value);
}

export function manualRegistrationTokenDisplayName(
  token: Pick<ManualRegistrationTokenDto, 'name'>,
): string {
  return token.name || 'Unnamed token';
}
