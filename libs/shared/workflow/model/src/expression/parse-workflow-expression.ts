import type {
  ParseWorkflowExpressionResult,
  WorkflowExpression,
  WorkflowExpressionBinaryOperator,
  WorkflowExpressionDiagnostic,
  WorkflowExpressionRoot,
} from './workflow-expression.js';

type Token =
  | {kind: 'identifier'; value: string; position: number}
  | {kind: 'string'; value: string; position: number}
  | {kind: 'number'; value: number; position: number}
  | {kind: 'boolean'; value: boolean; position: number}
  | {kind: 'operator'; value: WorkflowExpressionBinaryOperator | '!'; position: number}
  | {kind: 'dot'; value: '.'; position: number}
  | {kind: 'openParen'; value: '('; position: number}
  | {kind: 'closeParen'; value: ')'; position: number}
  | {kind: 'eof'; value: ''; position: number};

const binaryPrecedence: Readonly<Record<WorkflowExpressionBinaryOperator, number>> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
};

const whitespacePattern = /\s/;
const identifierStartPattern = /[A-Za-z_]/;
const identifierPartPattern = /[A-Za-z0-9_-]/;
const digitPattern = /[0-9]/;

export function parseWorkflowExpression(source: string): ParseWorkflowExpressionResult {
  const tokenizer = new Tokenizer(source);
  const tokens = tokenizer.scan();
  if (tokens.valid === false) {
    return {valid: false, source, diagnostics: tokens.diagnostics};
  }

  const parser = new Parser(tokens.tokens);
  const expression = parser.parseExpression();
  if (expression === undefined) {
    return {valid: false, source, diagnostics: parser.diagnostics};
  }

  const next = parser.peek();
  if (next.kind !== 'eof') {
    parser.pushDiagnostic({
      code: 'WFE004',
      severity: 'error',
      message: `Unexpected token "${next.value}".`,
      position: next.position,
      details: {token: next.value},
    });
    return {
      valid: false,
      source,
      diagnostics: parser.diagnostics,
    };
  }

  return {valid: true, source, expression, diagnostics: []};
}

class Parser {
  private index = 0;
  public readonly diagnostics: WorkflowExpressionDiagnostic[] = [];

  public constructor(private readonly tokens: readonly Token[]) {}

  public parseExpression(minPrecedence = 1): WorkflowExpression | undefined {
    let left = this.parsePrefix();
    if (left === undefined) return undefined;

    while (true) {
      const token = this.peek();
      if (token.kind !== 'operator' || token.value === '!') return left;

      const precedence = binaryPrecedence[token.value];
      if (precedence < minPrecedence) return left;
      this.advance();

      const right = this.parseExpression(precedence + 1);
      if (right === undefined) return undefined;

      left = {
        kind: 'binary',
        op: token.value,
        left,
        right,
      };
    }
  }

  public peek(): Token {
    return (
      this.tokens[this.index] ??
      this.tokens[this.tokens.length - 1] ?? {kind: 'eof', value: '', position: 0}
    );
  }

  public pushDiagnostic(diagnostic: WorkflowExpressionDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }

  private parsePrefix(): WorkflowExpression | undefined {
    const token = this.advance();
    if (token.kind === 'string') return {kind: 'string', value: token.value};
    if (token.kind === 'number') return {kind: 'number', value: token.value};
    if (token.kind === 'boolean') return {kind: 'boolean', value: token.value};
    if (token.kind === 'identifier') return this.parseRef(token);

    if (token.kind === 'operator' && token.value === '!') {
      const argument = this.parseExpression(5);
      if (argument === undefined) return undefined;
      return {kind: 'unary', op: '!', argument};
    }

    if (token.kind === 'openParen') {
      const expression = this.parseExpression();
      if (expression === undefined) return undefined;
      const close = this.advance();
      if (close.kind === 'closeParen') return expression;
      this.diagnostics.push({
        code: 'WFE007',
        severity: 'error',
        message: 'Expected closing parenthesis.',
        position: close.position,
      });
      return undefined;
    }

    this.diagnostics.push({
      code: 'WFE006',
      severity: 'error',
      message: 'Expected expression.',
      position: token.position,
      details: {token: token.value},
    });
    return undefined;
  }

  private parseRef(token: Extract<Token, {kind: 'identifier'}>): WorkflowExpression | undefined {
    if (!isAllowedRoot(token.value)) {
      this.diagnostics.push({
        code: 'WFE003',
        severity: 'error',
        message: `Reference root "${token.value}" is not supported in this expression.`,
        position: token.position,
        details: {root: token.value, allowedRoots: ['event']},
      });
      return undefined;
    }

    const path: [WorkflowExpressionRoot, ...string[]] = [token.value];
    while (this.peek().kind === 'dot') {
      this.advance();
      const segment = this.advance();
      if (segment.kind !== 'identifier') {
        this.diagnostics.push({
          code: 'WFE005',
          severity: 'error',
          message: 'Expected reference path segment after ".".',
          position: segment.position,
        });
        return undefined;
      }
      path.push(segment.value);
    }

    if (path.length === 1) {
      this.diagnostics.push({
        code: 'WFE005',
        severity: 'error',
        message: 'Expected reference path segment after root "event".',
        position: token.position,
        details: {root: token.value},
      });
      return undefined;
    }

    return {kind: 'ref', path};
  }

  private advance(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

class Tokenizer {
  private index = 0;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: WorkflowExpressionDiagnostic[] = [];

  public constructor(private readonly source: string) {}

  public scan():
    | {valid: true; tokens: readonly Token[]}
    | {valid: false; diagnostics: readonly WorkflowExpressionDiagnostic[]} {
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === undefined) break;
      if (whitespacePattern.test(char)) {
        this.index += 1;
        continue;
      }

      if (isIdentifierStart(char)) {
        this.scanIdentifier();
        continue;
      }

      if (isDigit(char)) {
        this.scanNumber();
        continue;
      }

      if (char === '-' && isDigit(this.source[this.index + 1])) {
        this.scanNumber();
        continue;
      }

      if (char === '"' || char === "'") {
        this.scanString(char);
        if (this.diagnostics.length > 0) return {valid: false, diagnostics: this.diagnostics};
        continue;
      }

      if (char === '.') {
        this.tokens.push({kind: 'dot', value: '.', position: this.index});
        this.index += 1;
        continue;
      }

      if (char === '(') {
        this.tokens.push({kind: 'openParen', value: '(', position: this.index});
        this.index += 1;
        continue;
      }

      if (char === ')') {
        this.tokens.push({kind: 'closeParen', value: ')', position: this.index});
        this.index += 1;
        continue;
      }

      if (this.scanOperator()) continue;

      this.diagnostics.push({
        code: 'WFE001',
        severity: 'error',
        message: `Unexpected character "${char}".`,
        position: this.index,
        details: {character: char},
      });
      return {valid: false, diagnostics: this.diagnostics};
    }

    this.tokens.push({kind: 'eof', value: '', position: this.source.length});
    return {valid: true, tokens: this.tokens};
  }

  private scanIdentifier(): void {
    const position = this.index;
    this.index += 1;
    while (isIdentifierPart(this.source[this.index])) this.index += 1;

    const value = this.source.slice(position, this.index);
    if (value === 'true' || value === 'false') {
      this.tokens.push({kind: 'boolean', value: value === 'true', position});
      return;
    }

    this.tokens.push({kind: 'identifier', value, position});
  }

  private scanNumber(): void {
    const position = this.index;
    if (this.source[this.index] === '-') this.index += 1;
    this.index += 1;
    while (isDigit(this.source[this.index])) this.index += 1;
    if (this.source[this.index] === '.' && isDigit(this.source[this.index + 1])) {
      this.index += 1;
      while (isDigit(this.source[this.index])) this.index += 1;
    }
    this.tokens.push({
      kind: 'number',
      value: Number(this.source.slice(position, this.index)),
      position,
    });
  }

  private scanString(quote: '"' | "'"): void {
    const position = this.index;
    this.index += 1;
    let value = '';

    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === quote) {
        this.index += 1;
        this.tokens.push({kind: 'string', value, position});
        return;
      }

      if (char === '\\') {
        const next = this.source[this.index + 1];
        if (next === undefined) break;
        value += unescapeStringChar(next);
        this.index += 2;
        continue;
      }

      value += char;
      this.index += 1;
    }

    this.diagnostics.push({
      code: 'WFE002',
      severity: 'error',
      message: 'Unterminated string literal.',
      position,
    });
  }

  private scanOperator(): boolean {
    const twoChar = this.source.slice(this.index, this.index + 2);
    if (isBinaryOperator(twoChar)) {
      this.tokens.push({kind: 'operator', value: twoChar, position: this.index});
      this.index += 2;
      return true;
    }

    const char = this.source[this.index];
    if (char === '!' || char === '<' || char === '>') {
      this.tokens.push({kind: 'operator', value: char, position: this.index});
      this.index += 1;
      return true;
    }

    return false;
  }
}

function isAllowedRoot(value: string): value is WorkflowExpressionRoot {
  return value === 'event';
}

function isIdentifierStart(value: string | undefined): value is string {
  return value !== undefined && identifierStartPattern.test(value);
}

function isIdentifierPart(value: string | undefined): value is string {
  return value !== undefined && identifierPartPattern.test(value);
}

function isDigit(value: string | undefined): value is string {
  return value !== undefined && digitPattern.test(value);
}

function isBinaryOperator(value: string): value is WorkflowExpressionBinaryOperator {
  return (
    value === '==' ||
    value === '!=' ||
    value === '<=' ||
    value === '>=' ||
    value === '&&' ||
    value === '||'
  );
}

function unescapeStringChar(value: string): string {
  if (value === 'n') return '\n';
  if (value === 'r') return '\r';
  if (value === 't') return '\t';
  return value;
}
