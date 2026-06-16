export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '-';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) return `${minutes}m${String(remainingSeconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h${String(remainingMinutes).padStart(2, '0')}m`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRelativeTime(iso: string, nowIso?: string): string {
  const now = nowIso ? new Date(nowIso).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
