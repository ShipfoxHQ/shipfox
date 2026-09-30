export const DISCORD_MESSAGE_LIMIT = 2_000;
export const DISCORD_MAX_MESSAGE_PARTS = 5;

const SEPARATORS = ['\n\n', '\n', ' '] as const;

/**
 * Splits text into parts of at most `DISCORD_MESSAGE_LIMIT` characters, cutting on the last
 * paragraph break, else line break, else space that fits. Text with none of them is cut at the
 * limit. Returns `undefined` when the text needs more than `DISCORD_MAX_MESSAGE_PARTS` parts.
 */
export function splitDiscordMessage(text: string): string[] | undefined {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > DISCORD_MESSAGE_LIMIT) {
    if (parts.length === DISCORD_MAX_MESSAGE_PARTS - 1) return undefined;
    const cut = cutIndex(rest);
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

function cutIndex(text: string): number {
  const window = text.slice(0, DISCORD_MESSAGE_LIMIT);
  for (const separator of SEPARATORS) {
    const index = window.lastIndexOf(separator);
    if (index > 0) return index;
  }
  // Do not leave half of a surrogate pair on each side of the cut.
  return isHighSurrogate(window.charCodeAt(DISCORD_MESSAGE_LIMIT - 1))
    ? DISCORD_MESSAGE_LIMIT - 1
    : DISCORD_MESSAGE_LIMIT;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
