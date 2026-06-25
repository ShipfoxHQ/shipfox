export interface CodeBlockHighlightedLineRange {
  startLine: number;
  endLine: number;
}

export const CODE_BLOCK_HIGHLIGHTED_LINE_CLASS = 'highlighted-line';

const CODE_BLOCK_LINE_SPAN_RE = /<span class="([^"]*\bline\b[^"]*)"/gu;
const CLASS_NAME_SEPARATOR_RE = /\s+/u;

export function isCodeBlockLineHighlighted(
  lineNumber: number,
  range: CodeBlockHighlightedLineRange | null | undefined,
): boolean {
  const normalized = normalizeCodeBlockHighlightedLineRange(range);
  if (!normalized) return false;
  return lineNumber >= normalized.startLine && lineNumber <= normalized.endLine;
}

export function highlightCodeBlockHtmlLines(
  html: string,
  range: CodeBlockHighlightedLineRange | null | undefined,
): string {
  const normalized = normalizeCodeBlockHighlightedLineRange(range);
  if (!normalized) return html;

  let lineNumber = 0;
  return html.replace(CODE_BLOCK_LINE_SPAN_RE, (match, className: string) => {
    lineNumber += 1;
    if (lineNumber < normalized.startLine || lineNumber > normalized.endLine) return match;
    if (className.split(CLASS_NAME_SEPARATOR_RE).includes(CODE_BLOCK_HIGHLIGHTED_LINE_CLASS)) {
      return match;
    }
    return `<span class="${className} ${CODE_BLOCK_HIGHLIGHTED_LINE_CLASS}"`;
  });
}

function normalizeCodeBlockHighlightedLineRange(
  range: CodeBlockHighlightedLineRange | null | undefined,
): CodeBlockHighlightedLineRange | undefined {
  if (!range) return undefined;
  if (!Number.isFinite(range.startLine) || !Number.isFinite(range.endLine)) return undefined;

  const startLine = Math.trunc(range.startLine);
  const endLine = Math.trunc(range.endLine);
  if (startLine < 1 || endLine < 1) return undefined;

  return {
    startLine: Math.min(startLine, endLine),
    endLine: Math.max(startLine, endLine),
  };
}
