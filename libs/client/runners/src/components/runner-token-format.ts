import type {RunnerTokenDto} from '@shipfox/api-runners-dto';
import {formatTimestamp} from '@shipfox/react-ui';

export function formatRunnerTokenDate(value: string | null): string {
  if (!value) return 'Never';
  return formatTimestamp(value);
}

export function runnerTokenDisplayName(token: RunnerTokenDto): string {
  return token.name || 'Unnamed token';
}
