export const outputLine = (data: string, ts = 1): string =>
  `${JSON.stringify({v: 1, ts, type: 'output', stream: 'stdout', data})}\n`;

export function inlineLogBody(ndjson: string, nextCursor: number) {
  return {
    mode: 'inline' as const,
    ndjson,
    next_cursor: nextCursor,
    has_more: false,
    state: 'closed' as const,
    truncated: false,
  };
}
