const NOTION_ID_RE =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;
const UNHYPHENATED_NOTION_ID_RE = /^[0-9a-f]{32}$/i;

export function normalizeNotionId(value: string): string {
  const input = value.trim();
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    return normalizeUuid(input);
  }

  const url = new URL(input);
  const match = decodeURIComponent(url.pathname).match(NOTION_ID_RE);
  if (!match?.[1]) return input;
  return normalizeUuid(match[1]);
}

function normalizeUuid(value: string): string {
  if (!UNHYPHENATED_NOTION_ID_RE.test(value)) return value;
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`.toLowerCase();
}
