import {
  createWorkflowExpression,
  unsafeWorkflowExpressionFromSource,
} from './create-workflow-expression.js';
import {InvalidWorkflowExpressionError} from './errors.js';
import type {ExpressionScalarType} from './workflow-expression.js';

describe('createWorkflowExpression', () => {
  it('returns a CEL workflow expression when the source parses and type-checks', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      typeEnvironment: {
        event: {kind: 'object', fields: {conclusion: 'string'}},
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source: 'event.conclusion == "success"',
    });
  });

  it('rejects misspelled fields from the typed context', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'event.conclsion == "success"',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
    expect(act).toThrow('Invalid workflow expression');
  });

  it('exposes the source and type-check reason on invalid expression errors', () => {
    let error: unknown;
    try {
      createWorkflowExpression({
        source: 'event.conclsion == "success"',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidWorkflowExpressionError);
    expect(error).toMatchObject({
      code: 'invalid-workflow-expression',
      name: 'InvalidWorkflowExpressionError',
      source: 'event.conclsion == "success"',
    });
    expect((error as InvalidWorkflowExpressionError).reason).toContain('conclsion');
  });

  it.each([
    ['string', 'event.value == "success"'],
    ['int', 'event.value >= 1'],
    ['uint', 'event.value >= 1'],
    ['double', 'event.value >= 1.5'],
    ['bool', 'event.value == true'],
    ['null', 'event.value == null'],
    ['timestamp', 'event.value < timestamp("2026-01-01T00:00:00Z")'],
  ] satisfies readonly [
    ExpressionScalarType,
    string,
  ][])('type-checks %s fields', (scalarType, source) => {
    const expression = createWorkflowExpression({
      source,
      typeEnvironment: {
        event: {kind: 'object', fields: {value: scalarType}},
      },
    });

    expect(expression).toEqual({
      language: 'cel',
      source,
    });
  });

  it('rejects parse errors before type checking', () => {
    const act = () =>
      createWorkflowExpression({
        source: 'event.conclusion ==',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      });

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('rejects blank sources', () => {
    const act = () => createWorkflowExpression({source: '   '});

    expect(act).toThrow(InvalidWorkflowExpressionError);
  });

  it('trims accepted sources before storing them', () => {
    const expression = createWorkflowExpression({
      source: '  event.conclusion == "success"  ',
      typeEnvironment: {
        event: {kind: 'object', fields: {conclusion: 'string'}},
      },
    });

    expect(expression.source).toBe('event.conclusion == "success"');
  });

  it('does not expose vendor ASTs or checked metadata', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      typeEnvironment: {
        event: {kind: 'object', fields: {conclusion: 'string'}},
      },
    });

    expect(Object.keys(expression)).toEqual(['language', 'source']);
  });

  it('rehydrates already-validated sources without calling the CEL parser', () => {
    const expression = unsafeWorkflowExpressionFromSource('event.conclusion == "success"');

    expect(expression).toEqual({
      language: 'cel',
      source: 'event.conclusion == "success"',
    });
  });
});
