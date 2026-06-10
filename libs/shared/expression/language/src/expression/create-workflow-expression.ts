import {Runtime} from '@gresb/cel-javascript';
import {InvalidWorkflowExpressionError} from './errors.js';
import type {
  CreateWorkflowExpressionParams,
  ExpressionScalarType,
  ExpressionType,
  ExpressionTypeEnvironment,
  ValidCelExpression,
  WorkflowExpression,
} from './workflow-expression.js';

const scalarTypeToCelType = {
  string: 'string',
  int: 'int',
  double: 'float',
  bool: 'bool',
  null: 'null',
  timestamp: 'timestamp',
} satisfies Record<ExpressionScalarType, string>;

export function createWorkflowExpression(
  params: CreateWorkflowExpressionParams,
): WorkflowExpression {
  const source = params.source.trim();
  if (source.length === 0) {
    throw new InvalidWorkflowExpressionError({
      source: params.source,
      reason: 'Expression source must not be empty.',
    });
  }

  const parseResult = Runtime.parseString(source);
  if (!parseResult.success) {
    throw new InvalidWorkflowExpressionError({
      source,
      reason: parseResult.error ?? 'Expression source could not be parsed.',
    });
  }

  if (params.check.mode === 'typed') {
    const typeCheckResult = Runtime.typeCheck(
      source,
      {},
      toCelTypeEnvironment(params.check.typeEnvironment ?? {}),
    );
    if (!typeCheckResult.success) {
      throw new InvalidWorkflowExpressionError({
        source,
        reason: typeCheckResult.error ?? 'Expression source did not type-check.',
      });
    }
  }

  return {
    language: 'cel',
    source: source as ValidCelExpression,
    check: params.check.mode,
  };
}

export function unsafeWorkflowExpressionFromSource(params: {
  source: string;
  check: WorkflowExpression['check'];
}): WorkflowExpression {
  // Use only when rehydrating a source that was already validated before storage.
  return {
    language: 'cel',
    source: params.source as ValidCelExpression,
    check: params.check,
  };
}

function toCelTypeEnvironment(
  typeEnvironment: ExpressionTypeEnvironment,
): Record<string, string | Record<string, unknown> | unknown[]> {
  return Object.fromEntries(
    Object.entries(typeEnvironment).map(([name, type]) => [name, toCelType(type)]),
  );
}

function toCelType(type: ExpressionType): string | Record<string, unknown> | unknown[] {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'list') return [toCelType(type.element)];

  return Object.fromEntries(
    Object.entries(type.fields).map(([name, field]) => [name, toCelType(field)]),
  );
}
