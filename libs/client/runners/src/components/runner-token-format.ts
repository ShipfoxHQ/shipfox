import type {RunnerTokenDto} from '@shipfox/api-runners-dto';

export function formatRunnerTokenDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function runnerTokenDisplayName(token: RunnerTokenDto): string {
  return token.name || 'Unnamed token';
}
