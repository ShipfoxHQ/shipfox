import {
  evaluateWorkflowExpression,
  evaluateWorkflowPredicate,
} from './evaluate-workflow-expression.js';
import {parseWorkflowExpression} from './parse-workflow-expression.js';

describe('parseWorkflowExpression', () => {
  it('parses a trigger filter into a stable expression AST', () => {
    const result = parseWorkflowExpression('event.ref == "refs/heads/main"');

    expect(result).toEqual({
      valid: true,
      source: 'event.ref == "refs/heads/main"',
      expression: {
        kind: 'binary',
        op: '==',
        left: {kind: 'ref', path: ['event', 'ref']},
        right: {kind: 'string', value: 'refs/heads/main'},
      },
      diagnostics: [],
    });
  });

  it('parses boolean operators and comparison precedence', () => {
    const result = parseWorkflowExpression(
      'event.action == "opened" && event.score >= 2 || event.draft == false',
    );

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.expression).toEqual({
      kind: 'binary',
      op: '||',
      left: {
        kind: 'binary',
        op: '&&',
        left: {
          kind: 'binary',
          op: '==',
          left: {kind: 'ref', path: ['event', 'action']},
          right: {kind: 'string', value: 'opened'},
        },
        right: {
          kind: 'binary',
          op: '>=',
          left: {kind: 'ref', path: ['event', 'score']},
          right: {kind: 'number', value: 2},
        },
      },
      right: {
        kind: 'binary',
        op: '==',
        left: {kind: 'ref', path: ['event', 'draft']},
        right: {kind: 'boolean', value: false},
      },
    });
  });

  it('parses parentheses and unary not', () => {
    const result = parseWorkflowExpression('!(event.draft == true)');

    expect(result).toEqual({
      valid: true,
      source: '!(event.draft == true)',
      expression: {
        kind: 'unary',
        op: '!',
        argument: {
          kind: 'binary',
          op: '==',
          left: {kind: 'ref', path: ['event', 'draft']},
          right: {kind: 'boolean', value: true},
        },
      },
      diagnostics: [],
    });
  });

  it('parses negative number literals', () => {
    const result = parseWorkflowExpression('event.score >= -2');

    expect(result).toEqual({
      valid: true,
      source: 'event.score >= -2',
      expression: {
        kind: 'binary',
        op: '>=',
        left: {kind: 'ref', path: ['event', 'score']},
        right: {kind: 'number', value: -2},
      },
      diagnostics: [],
    });
  });

  it('parses step output references for gate expressions', () => {
    const result = parseWorkflowExpression('step.output.pass == true');

    expect(result).toEqual({
      valid: true,
      source: 'step.output.pass == true',
      expression: {
        kind: 'binary',
        op: '==',
        left: {kind: 'ref', path: ['step', 'output', 'pass']},
        right: {kind: 'boolean', value: true},
      },
      diagnostics: [],
    });
  });

  it('rejects unsupported reference roots', () => {
    const result = parseWorkflowExpression('job.output.pass == true');

    expect(result).toEqual({
      valid: false,
      source: 'job.output.pass == true',
      diagnostics: [
        {
          code: 'WFE003',
          severity: 'error',
          message: 'Reference root "job" is not supported in this expression.',
          position: 0,
          details: {root: 'job', allowedRoots: ['event', 'step']},
        },
      ],
    });
  });

  it('reports invalid syntax with stable diagnostics', () => {
    const result = parseWorkflowExpression('event.ref ==');

    expect(result).toEqual({
      valid: false,
      source: 'event.ref ==',
      diagnostics: [
        {
          code: 'WFE006',
          severity: 'error',
          message: 'Expected expression.',
          position: 12,
          details: {token: ''},
        },
      ],
    });
  });

  it('reports trailing tokens', () => {
    const result = parseWorkflowExpression('event.ref "main"');

    expect(result).toEqual({
      valid: false,
      source: 'event.ref "main"',
      diagnostics: [
        {
          code: 'WFE004',
          severity: 'error',
          message: 'Unexpected token "main".',
          position: 10,
          details: {token: 'main'},
        },
      ],
    });
  });

  it('reports missing closing parentheses', () => {
    const result = parseWorkflowExpression('(event.ref == "main"');

    expect(result).toEqual({
      valid: false,
      source: '(event.ref == "main"',
      diagnostics: [
        {
          code: 'WFE007',
          severity: 'error',
          message: 'Expected closing parenthesis.',
          position: 20,
        },
      ],
    });
  });

  it('reports dangling reference path separators', () => {
    const result = parseWorkflowExpression('event.');

    expect(result).toEqual({
      valid: false,
      source: 'event.',
      diagnostics: [
        {
          code: 'WFE005',
          severity: 'error',
          message: 'Expected reference path segment after ".".',
          position: 6,
        },
      ],
    });
  });

  it('reports bare reference roots', () => {
    const result = parseWorkflowExpression('event');

    expect(result).toEqual({
      valid: false,
      source: 'event',
      diagnostics: [
        {
          code: 'WFE005',
          severity: 'error',
          message: 'Expected reference path segment after root "event".',
          position: 0,
          details: {root: 'event'},
        },
      ],
    });
  });

  it('reports unexpected characters', () => {
    const result = parseWorkflowExpression('event.ref = "main"');

    expect(result).toEqual({
      valid: false,
      source: 'event.ref = "main"',
      diagnostics: [
        {
          code: 'WFE001',
          severity: 'error',
          message: 'Unexpected character "=".',
          position: 10,
          details: {character: '='},
        },
      ],
    });
  });

  it('reports unterminated strings', () => {
    const result = parseWorkflowExpression('event.ref == "main');

    expect(result).toEqual({
      valid: false,
      source: 'event.ref == "main',
      diagnostics: [
        {
          code: 'WFE002',
          severity: 'error',
          message: 'Unterminated string literal.',
          position: 13,
        },
      ],
    });
  });
});

describe('evaluateWorkflowExpression', () => {
  it('evaluates parsed trigger filters deterministically through predicate evaluation', () => {
    const result = parseWorkflowExpression('event.ref == "refs/heads/main" && event.score >= 2');
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const value = evaluateWorkflowPredicate(result.expression, {
      event: {ref: 'refs/heads/main', score: 3},
    });

    expect(value).toBe(true);
  });

  it('returns false for missing references in comparisons', () => {
    const result = parseWorkflowExpression('event.ref == "refs/heads/main"');
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const value = evaluateWorkflowExpression(result.expression, {event: {}});

    expect(value).toBe(false);
  });

  it('returns false when both compared references are missing', () => {
    const result = parseWorkflowExpression('event.a == event.b');
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const value = evaluateWorkflowExpression(result.expression, {event: {}});

    expect(value).toBe(false);
  });

  it.each([
    ['not equal', 'event.ref != "refs/heads/main"', {ref: 'refs/heads/dev'}, true],
    ['less than', 'event.score < 2', {score: 1}, true],
    ['less than or equal', 'event.score <= 2', {score: 2}, true],
    ['greater than', 'event.score > 2', {score: 3}, true],
    ['greater than or equal', 'event.score >= 2', {score: 2}, true],
    ['or', 'event.draft == true || event.score > 2', {draft: false, score: 3}, true],
    ['unary not', '!(event.draft == true)', {draft: false}, true],
    ['strict equality mismatch', 'event.score == "2"', {score: 2}, false],
  ])('evaluates %s', (_name, source, event, expected) => {
    const result = parseWorkflowExpression(source);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const value = evaluateWorkflowExpression(result.expression, {event});

    expect(value).toBe(expected);
  });

  it('evaluates deep event paths', () => {
    const result = parseWorkflowExpression('event.pull_request.draft == false');
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const value = evaluateWorkflowExpression(result.expression, {
      event: {pull_request: {draft: false}},
    });

    expect(value).toBe(true);
  });

  it('evaluates step output paths', () => {
    const result = parseWorkflowExpression('step.output.pass == true');
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const value = evaluateWorkflowExpression(result.expression, {
      event: {},
      step: {output: {pass: true}},
    });

    expect(value).toBe(true);
  });

  it('uses parenthesized grouping during evaluation', () => {
    const result = parseWorkflowExpression(
      '(event.a == true || event.b == true) && event.c == true',
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const value = evaluateWorkflowExpression(result.expression, {
      event: {a: false, b: true, c: true},
    });

    expect(value).toBe(true);
  });

  it('evaluates literal expressions but predicate evaluation only treats true as a match', () => {
    const parsedString = parseWorkflowExpression('"main"');
    expect(parsedString.valid).toBe(true);
    if (!parsedString.valid) return;

    const stringValue = evaluateWorkflowExpression(parsedString.expression, {event: {}});
    const predicateValue = evaluateWorkflowPredicate(parsedString.expression, {event: {}});

    expect(stringValue).toBe('main');
    expect(predicateValue).toBe(false);
  });
});
