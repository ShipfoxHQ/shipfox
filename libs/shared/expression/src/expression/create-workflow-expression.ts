import {Environment, parse as parseCel} from '@marcbachmann/cel-js';
import {InvalidWorkflowExpressionError} from './errors.js';
import type {
  CreateWorkflowExpressionParams,
  ExpressionScalarType,
  ExpressionType,
  ValidCelExpression,
  WorkflowExpression,
} from './workflow-expression.js';

const scalarTypeToCelType = {
  string: 'string',
  int: 'int',
  double: 'double',
  bool: 'bool',
  null: 'null',
  timestamp: 'google.protobuf.Timestamp',
} satisfies Record<ExpressionScalarType, string>;

type CelSchema = {
  [field: string]: string | CelSchema;
};

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

  try {
    parseCel(source);
  } catch (error) {
    throw new InvalidWorkflowExpressionError({
      source,
      reason: error instanceof Error ? error.message : 'Expression source could not be parsed.',
    });
  }

  if (params.check.mode === 'typed') {
    const environment = new Environment({unlistedVariablesAreDyn: false});
    for (const [name, type] of Object.entries(params.check.typeEnvironment ?? {})) {
      const celType = toCelType(type, environment, name);
      if (typeof celType === 'string') {
        environment.registerVariable(name, celType);
      } else {
        environment.registerVariable({name, schema: celType.schema});
      }
    }

    const typeCheckResult = environment.check(source);
    if (!typeCheckResult.valid) {
      throw new InvalidWorkflowExpressionError({
        source,
        reason: typeCheckResult.error?.message ?? 'Expression source did not type-check.',
      });
    }
    if (
      params.check.expectedResultType !== undefined &&
      typeCheckResult.type !== scalarTypeToCelType[params.check.expectedResultType]
    ) {
      throw new InvalidWorkflowExpressionError({
        source,
        reason: `Expression source must return ${scalarTypeToCelType[params.check.expectedResultType]}; got ${typeCheckResult.type ?? 'unknown'}.`,
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

function toCelType(
  type: ExpressionType,
  environment: Environment,
  variableName: string,
): string | {schema: CelSchema} {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'list') {
    return `list<${toCelListElementType(type.element, environment, variableName)}>`;
  }

  return {
    schema: Object.fromEntries(
      Object.entries(type.fields).map(([name, field]) => [name, toCelSchemaType(field)]),
    ),
  };
}

function toCelSchemaType(type: ExpressionType): string | CelSchema {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'list') return `list<${toCelSchemaListElementType(type.element)}>`;
  return Object.fromEntries(
    Object.entries(type.fields).map(([name, field]) => [name, toCelSchemaType(field)]),
  );
}

function toCelSchemaListElementType(type: ExpressionType): string {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'object') return 'dyn';
  return `list<${toCelSchemaListElementType(type.element)}>`;
}

function toCelListElementType(
  type: ExpressionType,
  environment: Environment,
  variableName: string,
): string {
  if (typeof type === 'string') return scalarTypeToCelType[type];
  if (type.kind === 'object') {
    const typeName = `$${variableName}.item`;
    environment.registerType({
      name: typeName,
      schema: Object.fromEntries(
        Object.entries(type.fields).map(([name, field]) => [name, toCelSchemaType(field)]),
      ),
    });
    return typeName;
  }
  return 'dyn';
}
