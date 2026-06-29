import {InvalidWorkflowExpressionError} from '../expression/errors.js';
import {InvalidWorkflowTemplateError} from './errors.js';
import {parseWorkflowTemplate} from './parse-workflow-template.js';
import {scanLineComment, scanStringLiteral} from './scan-cel-token.js';
import type {
  WorkflowTemplateExprSegment,
  WorkflowTemplateLiteralSegment,
} from './template-segment.js';

const templateOpen = '$' + '{{';
const templateClose = '}' + '}';
const escapedTemplateOpen = `$${templateOpen}`;
const tripleDollarTemplateOpen = `$${escapedTemplateOpen}`;

function templateExpression(source: string): string {
  return `${templateOpen}${source}${templateClose}`;
}

function templateSpanFromOpen(open: string, source: string): string {
  return `${open}${source}${templateClose}`;
}

describe('parseWorkflowTemplate', () => {
  it('round-trips literal text as a literal segment', () => {
    const segments = parseWorkflowTemplate('deploy main');

    expect(segments).toEqual([{kind: 'literal', text: 'deploy main'}]);
  });

  it('returns no segments for empty input', () => {
    const segments = parseWorkflowTemplate('');

    expect(segments).toEqual([]);
  });

  it('preserves whitespace-only literals', () => {
    const segments = parseWorkflowTemplate('  \n  ');

    expect(segments).toEqual([{kind: 'literal', text: '  \n  '}]);
  });

  it('keeps leading literal whitespace before an expression', () => {
    const segments = parseWorkflowTemplate(`  ${templateExpression('event.ref')}`);

    expect(segments).toEqual([
      {kind: 'literal', text: '  '},
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'event.ref', check: 'syntax'},
        contextRoots: ['event'],
      },
    ]);
  });

  it('parses a single expression with trimmed syntax-checked source and context roots', () => {
    const segments = parseWorkflowTemplate(templateExpression(' event.ref '));

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'event.ref', check: 'syntax'},
        contextRoots: ['event'],
      },
    ]);
  });

  it('parses leading and trailing literal text around an expression', () => {
    const segments = parseWorkflowTemplate(`refs/${templateExpression(' event.ref ')}/done`);

    expect(segments).toEqual([
      {kind: 'literal', text: 'refs/'},
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'event.ref', check: 'syntax'},
        contextRoots: ['event'],
      },
      {kind: 'literal', text: '/done'},
    ]);
  });

  it('parses mixed literal and expression sandwiches', () => {
    const segments = parseWorkflowTemplate(
      `a ${templateExpression(' event.ref ')} b ${templateExpression(' inputs.name ')} c`,
    );

    expect(segments).toEqual([
      {kind: 'literal', text: 'a '},
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'event.ref', check: 'syntax'},
        contextRoots: ['event'],
      },
      {kind: 'literal', text: ' b '},
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'inputs.name', check: 'syntax'},
        contextRoots: ['inputs'],
      },
      {kind: 'literal', text: ' c'},
    ]);
  });

  it('does not emit empty literals between adjacent expressions', () => {
    const segments = parseWorkflowTemplate(
      templateExpression('event.ref') + templateExpression('inputs.name'),
    );

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'event.ref', check: 'syntax'},
        contextRoots: ['event'],
      },
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'inputs.name', check: 'syntax'},
        contextRoots: ['inputs'],
      },
    ]);
  });

  it('ignores closers inside quoted CEL strings', () => {
    const segments = parseWorkflowTemplate(templateExpression(' "a}}b" + \'c}}d\' + """e}}f""" '));

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {
          language: 'cel',
          source: '"a}}b" + \'c}}d\' + """e}}f"""',
          check: 'syntax',
        },
        contextRoots: [],
      },
    ]);
  });

  it('ignores closers after escaped quotes in non-raw strings', () => {
    const segments = parseWorkflowTemplate(
      templateExpression(' "a\\"}}b" == "a\\"}}b" && event.ok '),
    );

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {
          language: 'cel',
          source: '"a\\"}}b" == "a\\"}}b" && event.ok',
          check: 'syntax',
        },
        contextRoots: ['event'],
      },
    ]);
  });

  it('ignores closers inside bytes strings', () => {
    const segments = parseWorkflowTemplate(templateExpression(' b"a}}b" == b"a}}b" && event.ok '));

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {
          language: 'cel',
          source: 'b"a}}b" == b"a}}b" && event.ok',
          check: 'syntax',
        },
        contextRoots: ['event'],
      },
    ]);
  });

  it('ignores closers and quotes inside line comments', () => {
    const segments = parseWorkflowTemplate(
      templateExpression(' event.x // }} "ignored"\n && inputs.ok '),
    );

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {
          language: 'cel',
          source: 'event.x // }} "ignored"\n && inputs.ok',
          check: 'syntax',
        },
        contextRoots: ['event', 'inputs'],
      },
    ]);
  });

  it('does not close on braces inside map literals', () => {
    const segments = parseWorkflowTemplate(templateExpression(' {"k": event.v} '));

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {language: 'cel', source: '{"k": event.v}', check: 'syntax'},
        contextRoots: ['event'],
      },
    ]);
  });

  it('tracks nested map literal braces before the closer', () => {
    const segments = parseWorkflowTemplate(templateExpression(' {"a": {"b": 1}}.a.b '));

    expect(segments).toEqual([
      {
        kind: 'expr',
        expression: {language: 'cel', source: '{"a": {"b": 1}}.a.b', check: 'syntax'},
        contextRoots: [],
      },
    ]);
  });

  it('escapes a literal opener with a leading dollar', () => {
    const segments = parseWorkflowTemplate(
      templateSpanFromOpen(escapedTemplateOpen, ' event.ref '),
    );

    expect(segments).toEqual([{kind: 'literal', text: templateExpression(' event.ref ')}]);
  });

  it('greedily escapes the second dollar in a triple-dollar opener', () => {
    const segments = parseWorkflowTemplate(
      templateSpanFromOpen(tripleDollarTemplateOpen, ' event.ref '),
    );

    expect(segments).toEqual([
      {
        kind: 'literal',
        text: templateSpanFromOpen(escapedTemplateOpen, ' event.ref '),
      },
    ]);
  });

  it('passes lone dollar runs through when they do not escape an opener', () => {
    const segments = parseWorkflowTemplate('$ $$');

    expect(segments).toEqual([{kind: 'literal', text: '$ $$'}]);
  });

  it('parses an escaped opener followed by a real expression', () => {
    const segments = parseWorkflowTemplate(
      `$${templateExpression(' escaped ')} ${templateExpression(' event.ref ')}`,
    );

    expect(segments).toEqual([
      {kind: 'literal', text: `${templateExpression(' escaped ')} `},
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'event.ref', check: 'syntax'},
        contextRoots: ['event'],
      },
    ]);
  });

  it('throws template errors for unterminated openers', () => {
    const source = `before ${templateOpen} event.ref`;
    let error: unknown;
    try {
      parseWorkflowTemplate(source);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowTemplateError);
    expect(error).toMatchObject({
      code: 'invalid-workflow-template',
      source,
      reason: 'unterminated opener',
      offset: 7,
    });
    expect((error as Error).cause).toBeUndefined();
  });

  it('wraps empty expressions in template errors with the span offset', () => {
    const source = `before ${templateExpression(' ')}`;
    let error: unknown;
    try {
      parseWorkflowTemplate(source);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowTemplateError);
    expect(error).toMatchObject({
      source,
      offset: 7,
    });
    expect((error as InvalidWorkflowTemplateError).cause).toBeInstanceOf(
      InvalidWorkflowExpressionError,
    );
    expect((error as InvalidWorkflowTemplateError).reason).toBe(
      'Expression source must not be empty.',
    );
  });

  it('wraps invalid CEL in template errors with the offending span offset', () => {
    const source = `ok ${templateExpression(' event.ref ')} bad ${templateExpression(' event. ')}`;
    let error: unknown;
    try {
      parseWorkflowTemplate(source);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowTemplateError);
    expect(error).toMatchObject({
      source,
      offset: 24,
    });
    expect((error as InvalidWorkflowTemplateError).cause).toBeInstanceOf(
      InvalidWorkflowExpressionError,
    );
  });

  it('exposes only the expected segment keys', () => {
    const segments = parseWorkflowTemplate(`literal ${templateExpression(' event.ref ')}`);

    expect(segments).toHaveLength(2);
    const [literalSegment, expressionSegment] = segments as [
      WorkflowTemplateLiteralSegment,
      WorkflowTemplateExprSegment,
    ];
    expect(Object.keys(literalSegment)).toEqual(['kind', 'text']);
    expect(Object.keys(expressionSegment)).toEqual(['kind', 'expression', 'contextRoots']);
    expect(Object.keys(expressionSegment.expression)).toEqual(['language', 'source', 'check']);
  });

  it('preserves newlines in literal text', () => {
    const segments = parseWorkflowTemplate(`a\n${templateExpression(' event.ref ')}\nb`);

    expect(segments).toEqual([
      {kind: 'literal', text: 'a\n'},
      {
        kind: 'expr',
        expression: {language: 'cel', source: 'event.ref', check: 'syntax'},
        contextRoots: ['event'],
      },
      {kind: 'literal', text: '\nb'},
    ]);
  });
});

describe('scanStringLiteral', () => {
  it('returns null when no CEL string starts at the index', () => {
    const endIndex = scanStringLiteral('event.ref', 0);

    expect(endIndex).toBeNull();
  });

  it('returns the end of an unterminated string so callers can fail the span', () => {
    const endIndex = scanStringLiteral('"event.ref', 0);

    expect(endIndex).toBe('"event.ref'.length);
  });

  it('uses longest-prefix matching for triple-quoted strings', () => {
    const endIndex = scanStringLiteral('"""event.ref""" + inputs.ref', 0);

    expect(endIndex).toBe('"""event.ref"""'.length);
  });

  it('does not let raw-string backslashes escape the closing quote', () => {
    const endIndex = scanStringLiteral('r"event.ref\\" + inputs.ref', 0);

    expect(endIndex).toBe('r"event.ref\\"'.length);
  });
});

describe('scanLineComment', () => {
  it('returns null when no line comment starts at the index', () => {
    const endIndex = scanLineComment('/ event.ref', 0);

    expect(endIndex).toBeNull();
  });

  it('returns the newline index for line comments', () => {
    const endIndex = scanLineComment('// event.ref\ninputs.ref', 0);

    expect(endIndex).toBe('// event.ref'.length);
  });

  it('returns the source length for line comments ending at EOF', () => {
    const endIndex = scanLineComment('// event.ref', 0);

    expect(endIndex).toBe('// event.ref'.length);
  });
});
