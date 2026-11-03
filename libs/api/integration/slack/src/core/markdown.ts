// Slack caps the cumulative text across all Markdown blocks in one payload at 12,000 characters;
// content over that limit is rejected with invalid_blocks rather than truncated. Each tool here
// sends exactly one Markdown block, so the cap applies to that single block's text.
export const SLACK_MARKDOWN_BLOCK_MAX_LENGTH = 12_000;

// A Markdown block renders standard Markdown, which the plain text field does not; text is kept as
// the notification fallback, so its Markdown syntax is stripped rather than shown literally.
export function markdownMessage(message: unknown): Record<string, unknown> {
  if (typeof message !== 'string') return {};
  return {text: stripMarkdownForFallback(message), blocks: [{type: 'markdown', text: message}]};
}

const codeBlockPattern = /```[^\n]*\n?([\s\S]*?)\n?```/g;
const inlineCodePattern = /`([^`]+)`/g;
const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
const boldPattern = /\*\*([^*]+)\*\*|__([^_]+)__/g;
const strikethroughPattern = /~~([^~]+)~~/g;
const italicPattern = /\*([^*]+)\*|_([^_]+)_/g;
const blockquotePattern = /^>\s?/gm;
// Reserved code spans are wrapped in a delimiter built at runtime (String.fromCharCode) rather than
// a literal escape in source. A real chat message is vanishingly unlikely to contain a NUL byte, but
// isn't guaranteed not to, so any that do appear are stripped from the input first. After that, the
// only NUL bytes left are the ones this function inserts, so restoration can't misfire on user text.
const codePlaceholderDelimiter = String.fromCharCode(0);
const codePlaceholderPattern = new RegExp(
  `${codePlaceholderDelimiter}(\\d+)${codePlaceholderDelimiter}`,
  'g',
);

// Best-effort plain-text rendering of the Markdown syntax the tool description promises (bold,
// italic, strikethrough, links, lists, blockquotes, inline code, code blocks); lists are left as-is
// since "- item" and "1. item" already read fine as plain text. Code spans are pulled out behind a
// placeholder first so their own *, _, ~, and [] characters survive the other replacements intact.
function stripMarkdownForFallback(message: string): string {
  const codeSpans: string[] = [];
  const reserveCodeSpan = (_match: string, code: string): string =>
    `${codePlaceholderDelimiter}${codeSpans.push(code) - 1}${codePlaceholderDelimiter}`;

  return message
    .replaceAll(codePlaceholderDelimiter, '')
    .replace(codeBlockPattern, reserveCodeSpan)
    .replace(inlineCodePattern, reserveCodeSpan)
    .replace(linkPattern, (_match, text: string, url: string) => `${text} (${url})`)
    .replace(
      boldPattern,
      (_match, asterisk?: string, underscore?: string) => asterisk ?? underscore ?? '',
    )
    .replace(strikethroughPattern, (_match, text: string) => text)
    .replace(
      italicPattern,
      (_match, asterisk?: string, underscore?: string) => asterisk ?? underscore ?? '',
    )
    .replace(blockquotePattern, '')
    .replace(codePlaceholderPattern, (_match, index: string) => codeSpans[Number(index)] ?? '');
}

/** Splits at line breaks so each part fits a Markdown block. A line over the limit is cut. */
export function splitMarkdownMessage(message: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of message.split('\n')) {
    for (const piece of cutLine(line)) {
      const joined = current === '' ? piece : `${current}\n${piece}`;
      if ([...joined].length <= SLACK_MARKDOWN_BLOCK_MAX_LENGTH) {
        current = joined;
        continue;
      }
      parts.push(current);
      current = piece;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.trim() !== '');
}

function cutLine(line: string): string[] {
  const characters = [...line];
  const pieces: string[] = [];
  for (let start = 0; start < characters.length; start += SLACK_MARKDOWN_BLOCK_MAX_LENGTH) {
    pieces.push(characters.slice(start, start + SLACK_MARKDOWN_BLOCK_MAX_LENGTH).join(''));
  }
  return pieces.length > 0 ? pieces : [''];
}
