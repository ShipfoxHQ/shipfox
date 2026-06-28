import {scanLineComment, scanStringLiteral} from './scan-cel-token.js';

const reservedWords = new Set(['false', 'in', 'null', 'true']);
const whitespacePattern = /\s/;

export function extractCelRoots(source: string): string[] {
  const roots = new Set<string>();
  let index = 0;

  // The CEL vendor parser exposes no AST or token spans, so root extraction scans tokens here.
  while (index < source.length) {
    const stringEndIndex = scanStringLiteral(source, index);
    if (stringEndIndex !== null) {
      index = stringEndIndex;
      continue;
    }

    const commentEndIndex = scanLineComment(source, index);
    if (commentEndIndex !== null) {
      index = commentEndIndex;
      continue;
    }

    const char = source[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (isDigit(char)) {
      index = scanNumericLiteral(source, index);
      continue;
    }

    if (!isIdentifierStart(char)) {
      index += 1;
      continue;
    }

    const identifierStartIndex = index;
    index += 1;
    while (index < source.length && isIdentifierChar(source[index])) index += 1;

    const identifier = source.slice(identifierStartIndex, index);
    if (
      reservedWords.has(identifier) ||
      isMemberAccess(source, identifierStartIndex) ||
      isFunctionCall(source, index)
    ) {
      continue;
    }

    roots.add(identifier);
  }

  return [...roots].sort();
}

function scanNumericLiteral(source: string, index: number): number {
  if (source[index] === '0' && (source[index + 1] === 'x' || source[index + 1] === 'X')) {
    index += 2;
    while (index < source.length && isHexDigit(source[index])) index += 1;
    if (source[index] === 'u' || source[index] === 'U') index += 1;
    return index;
  }

  while (index < source.length && isDigit(source[index])) index += 1;

  if (source[index] === '.' && isDigit(source[index + 1])) {
    index += 1;
    while (index < source.length && isDigit(source[index])) index += 1;
  }

  if (source[index] === 'e' || source[index] === 'E') {
    const exponentStartIndex = index;
    index += 1;
    if (source[index] === '+' || source[index] === '-') index += 1;

    if (isDigit(source[index])) {
      while (index < source.length && isDigit(source[index])) index += 1;
    } else {
      index = exponentStartIndex;
    }
  }

  if (source[index] === 'u' || source[index] === 'U') index += 1;
  return index;
}

function isMemberAccess(source: string, identifierStartIndex: number): boolean {
  const dotIndex = previousNonWhitespaceIndex(source, identifierStartIndex - 1);
  if (dotIndex === null || source[dotIndex] !== '.') return false;

  const receiverEndIndex = previousNonWhitespaceIndex(source, dotIndex - 1);
  if (receiverEndIndex === null) return false;

  const receiverEndChar = source[receiverEndIndex];
  return (
    isIdentifierChar(receiverEndChar) ||
    receiverEndChar === ')' ||
    receiverEndChar === ']' ||
    receiverEndChar === '"' ||
    receiverEndChar === "'"
  );
}

function isFunctionCall(source: string, identifierEndIndex: number): boolean {
  const nextIndex = nextNonWhitespaceIndex(source, identifierEndIndex);
  return nextIndex !== null && source[nextIndex] === '(';
}

function previousNonWhitespaceIndex(source: string, index: number): number | null {
  while (index >= 0) {
    if (!isWhitespace(source[index])) return index;
    index -= 1;
  }

  return null;
}

function nextNonWhitespaceIndex(source: string, index: number): number | null {
  while (index < source.length) {
    if (!isWhitespace(source[index])) return index;
    index += 1;
  }

  return null;
}

function isIdentifierStart(char: string | undefined): boolean {
  return (
    char !== undefined &&
    ((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_')
  );
}

function isIdentifierChar(char: string | undefined): boolean {
  return isIdentifierStart(char) || isDigit(char);
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

function isHexDigit(char: string | undefined): boolean {
  return (
    isDigit(char) ||
    (char !== undefined && char >= 'A' && char <= 'F') ||
    (char !== undefined && char >= 'a' && char <= 'f')
  );
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && whitespacePattern.test(char);
}
