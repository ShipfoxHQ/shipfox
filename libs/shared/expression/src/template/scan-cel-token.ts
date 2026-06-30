const stringPrefixPatterns = [
  {prefix: 'r', raw: true},
  {prefix: 'R', raw: true},
  {prefix: 'b', raw: false},
  {prefix: 'B', raw: false},
  {prefix: '', raw: false},
] as const;

export function scanStringLiteral(source: string, index: number): number | null {
  for (const {prefix, raw} of stringPrefixPatterns) {
    if (!source.startsWith(prefix, index)) continue;

    const quoteIndex = index + prefix.length;
    const quote = source[quoteIndex];
    if (quote !== '"' && quote !== "'") continue;

    const tripleQuote = quote.repeat(3);
    if (source.startsWith(tripleQuote, quoteIndex)) {
      return scanQuotedString(source, quoteIndex + 3, tripleQuote, raw);
    }

    return scanQuotedString(source, quoteIndex + 1, quote, raw);
  }

  return null;
}

export function scanLineComment(source: string, index: number): number | null {
  if (!source.startsWith('//', index)) return null;

  const newlineIndex = source.indexOf('\n', index + 2);
  return newlineIndex === -1 ? source.length : newlineIndex;
}

function scanQuotedString(
  source: string,
  startIndex: number,
  delimiter: string,
  raw: boolean,
): number {
  let index = startIndex;
  while (index < source.length) {
    if (!raw && source[index] === '\\') {
      index += 2;
      continue;
    }

    if (source.startsWith(delimiter, index)) return index + delimiter.length;

    index += 1;
  }

  return source.length;
}
