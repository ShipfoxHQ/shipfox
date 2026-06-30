import type {ManualRegistrationTokenDto} from '@shipfox/api-runners-dto';
import {formatTimestamp} from '@shipfox/react-ui';

export function formatManualRegistrationTokenDate(value: string | null): string {
  if (!value) return 'Never';
  return formatTimestamp(value);
}

export function manualRegistrationTokenDisplayName(token: ManualRegistrationTokenDto): string {
  return token.name || 'Unnamed token';
}
