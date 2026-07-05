import {
  type WorkflowDocumentStepOutputType,
  workflowDocumentStepOutputTypes,
} from '@shipfox/workflow-document';
import {Ajv, type AnySchema} from 'ajv';
import type {ExpressionType} from '../expression/workflow-expression.js';

export type OutputType = WorkflowDocumentStepOutputType;

export interface OutputTypeDeclaration {
  readonly type: OutputType;
  readonly schema?: unknown;
}

export type OutputDeclarations = Readonly<Record<string, OutputTypeDeclaration>>;

export type JsonSchemaValidationResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly reason: string};

const ajv = new Ajv({strict: false});
const fallbackJsonType = {kind: 'map'} as const satisfies ExpressionType;

export {workflowDocumentStepOutputTypes as outputTypes};

export function outputDeclarationToExpressionType(
  declaration: OutputTypeDeclaration,
): ExpressionType {
  switch (declaration.type) {
    case 'string':
      return 'string';
    case 'number':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'json':
      return declaration.schema === undefined
        ? fallbackJsonType
        : jsonSchemaToExpressionType(declaration.schema);
  }
}

export function outputDeclarationsToExpressionFields(
  declarations: OutputDeclarations,
): Readonly<Record<string, ExpressionType>> {
  return Object.fromEntries(
    Object.entries(declarations).map(([key, declaration]) => [
      key,
      outputDeclarationToExpressionType(declaration),
    ]),
  );
}

export function jsonSchemaToExpressionType(schema: unknown): ExpressionType {
  if (!isPlainRecord(schema)) return fallbackJsonType;
  if (hasUnsupportedCombinator(schema)) return fallbackJsonType;

  const type = schema.type;
  if (Array.isArray(type)) return fallbackJsonType;

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
      return 'double';
    case 'integer':
      return 'int';
    case 'boolean':
      return 'bool';
    case 'null':
      return 'null';
    case 'array':
      return {
        kind: 'list',
        element: jsonSchemaToExpressionType(schema.items),
      };
    case 'object':
      return closedObjectJsonSchemaToExpressionType(schema);
    default:
      return fallbackJsonType;
  }
}

export function validateJsonSchema(schema: unknown): JsonSchemaValidationResult {
  const valid = ajv.validateSchema(schema as AnySchema);
  if (valid) return {ok: true};

  return {
    ok: false,
    reason: ajv.errorsText(ajv.errors, {separator: '; '}),
  };
}

function closedObjectJsonSchemaToExpressionType(
  schema: Readonly<Record<string, unknown>>,
): ExpressionType {
  const properties = schema.properties;
  const required = schema.required;
  // CEL object fields are required when statically typed. Optional JSON Schema
  // fields would make valid runtime values fail type-checking, so keep those
  // schemas opaque.
  if (
    schema.additionalProperties !== false ||
    !isPlainRecord(properties) ||
    !Array.isArray(required) ||
    !required.every((field) => typeof field === 'string') ||
    Object.keys(properties).some((field) => !required.includes(field))
  ) {
    return fallbackJsonType;
  }

  return {
    kind: 'object',
    fields: Object.fromEntries(
      Object.entries(properties).map(([field, fieldSchema]) => [
        field,
        jsonSchemaToExpressionType(fieldSchema),
      ]),
    ),
  };
}

function hasUnsupportedCombinator(schema: Readonly<Record<string, unknown>>): boolean {
  return (
    schema.oneOf !== undefined ||
    schema.anyOf !== undefined ||
    schema.allOf !== undefined ||
    schema.not !== undefined ||
    schema.enum !== undefined ||
    schema.const !== undefined ||
    schema.patternProperties !== undefined ||
    schema.nullable === true
  );
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
