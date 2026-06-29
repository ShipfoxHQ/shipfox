import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {InvalidWorkflowExpressionError} from '../expression/errors.js';
import {InvalidWorkflowTemplateError} from './errors.js';
import {extractCelRoots} from './extract-cel-roots.js';
import {scanLineComment, scanStringLiteral} from './scan-cel-token.js';
import type {WorkflowTemplateSegment} from './template-segment.js';

export function parseWorkflowTemplate(source: string): WorkflowTemplateSegment[] {
  const segments: WorkflowTemplateSegment[] = [];
  let literal = '';
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('$${{', index)) {
      literal += '${{';
      index += 4;
      continue;
    }

    if (!source.startsWith('${{', index)) {
      literal += source[index];
      index += 1;
      continue;
    }

    if (literal.length > 0) {
      segments.push({kind: 'literal', text: literal});
      literal = '';
    }

    const expressionStartIndex = index;
    const closeIndex = findExpressionCloseIndex(source, expressionStartIndex);
    if (closeIndex === null) {
      throw new InvalidWorkflowTemplateError({
        source,
        offset: expressionStartIndex,
        reason: 'unterminated opener',
      });
    }

    const innerSource = source.slice(expressionStartIndex + 3, closeIndex);
    const expression = createTemplateExpression(source, expressionStartIndex, innerSource);
    const roots = extractTemplateRoots(source, expressionStartIndex, expression.source);

    segments.push({kind: 'expr', expression, roots});
    index = closeIndex + 2;
  }

  if (literal.length > 0) segments.push({kind: 'literal', text: literal});
  return segments;
}

function findExpressionCloseIndex(source: string, openerIndex: number): number | null {
  let index = openerIndex + 3;
  let depth = 0;

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

    if (depth === 0 && source.startsWith('}}', index)) return index;

    const char = source[index];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if ((char === ')' || char === ']' || char === '}') && depth > 0) {
      depth -= 1;
    }

    index += 1;
  }

  return null;
}

function extractTemplateRoots(
  source: string,
  expressionStartIndex: number,
  expressionSource: string,
) {
  try {
    return extractCelRoots(expressionSource);
  } catch (error) {
    throw new InvalidWorkflowTemplateError({
      source,
      offset: expressionStartIndex,
      reason: error instanceof Error ? error.message : 'Expression roots could not be extracted.',
      cause: error,
    });
  }
}

function createTemplateExpression(
  source: string,
  expressionStartIndex: number,
  innerSource: string,
) {
  try {
    return createWorkflowExpression({
      source: innerSource,
      check: {mode: 'syntax'},
    });
  } catch (error) {
    if (error instanceof InvalidWorkflowExpressionError) {
      throw new InvalidWorkflowTemplateError({
        source,
        offset: expressionStartIndex,
        reason: error.reason,
        cause: error,
      });
    }

    throw error;
  }
}
