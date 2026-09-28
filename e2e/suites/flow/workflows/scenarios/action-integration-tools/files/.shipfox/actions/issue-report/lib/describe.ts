export function describe(label: string, value: unknown): string {
  return `${label}: ${String(value)}`;
}
