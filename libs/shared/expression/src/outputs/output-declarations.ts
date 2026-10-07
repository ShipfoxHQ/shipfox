import {
  type WorkflowDocumentStepOutputType,
  workflowDocumentStepOutputTypes,
} from '@shipfox/workflow-document';
import {Ajv, type AnySchema, type ValidateFunction} from 'ajv';
import type {ExpressionType} from '../expression/workflow-expression.js';

export type OutputType = WorkflowDocumentStepOutputType;

export interface OutputTypeDeclaration {
  readonly type: OutputType;
  readonly schema?: unknown;
  // Absent means required, so declarations written before this flag keep failing on a missing key.
  readonly required?: boolean;
  /** Stands in for the output when its step has no value for it. `null` is a value; `undefined` is no default. */
  readonly default?: unknown;
  // Run steps only: where the runner reads the value from instead of `$SHIPFOX_OUTPUT`.
  readonly from_file?: string | undefined;
  readonly from_stdout?: true | undefined;
}

export type OutputDeclarations = Readonly<Record<string, OutputTypeDeclaration>>;

export type JsonSchemaValidationResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly reason: string};

export type StepOutputCoercionErrorReason =
  | 'missing'
  | 'undeclared'
  | 'invalid_type'
  | 'invalid_json'
  | 'schema_invalid';

export interface StepOutputCoercionError {
  readonly key: string;
  readonly reason: StepOutputCoercionErrorReason;
  readonly expectedType?: OutputType;
  readonly message: string;
  readonly schemaError?: string;
}

export type CoerceStepOutputsResult =
  | {readonly ok: true; readonly output: Record<string, unknown>}
  | {readonly ok: false; readonly error: StepOutputCoercionError};

const ajv = new Ajv({strict: false});
const coercingAjv = new Ajv({
  strict: false,
  coerceTypes: true,
  allErrors: true,
  addUsedSchema: false,
});
// A default is stored as written, so it is checked without type coercion.
const defaultAjv = new Ajv({strict: false, allErrors: true, addUsedSchema: false});
const jsonOutputValidatorCache = new Map<string, ValidateFunction>();
const jsonDefaultValidatorCache = new Map<string, ValidateFunction>();
const fallbackJsonType = {kind: 'dyn'} as const satisfies ExpressionType;
const openObjectJsonType = {kind: 'map'} as const satisfies ExpressionType;

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
  if (hasDynamicSchemaShape(schema)) return fallbackJsonType;
  if (schema.patternProperties !== undefined) return openObjectJsonType;

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

export function hasOutputDefault(declaration: OutputTypeDeclaration): boolean {
  return declaration.default !== undefined;
}

/**
 * The declared defaults, keyed by output. Defaults are checked when the workflow
 * syncs, so they are returned as written.
 */
export function outputDefaults(
  declarations: OutputDeclarations | undefined,
): Record<string, unknown> {
  // fromEntries defines own properties, so a `__proto__` output key stays a key.
  return Object.fromEntries(
    Object.entries(declarations ?? {})
      .filter(([, declaration]) => hasOutputDefault(declaration))
      .map(([key, declaration]) => [key, cloneJsonValue(declaration.default)]),
  );
}

export type OutputDefaultValidationResult =
  | {readonly ok: true}
  | {readonly ok: false; readonly reason: string};

/**
 * A default is authored as a typed value, so a string default on a `number`
 * output is rejected even though a runner-reported "3" would coerce.
 */
export function validateOutputDefault(
  declaration: OutputTypeDeclaration,
): OutputDefaultValidationResult {
  if (!hasOutputDefault(declaration)) return {ok: true};
  const value = declaration.default;

  switch (declaration.type) {
    case 'string':
      return typeof value === 'string'
        ? {ok: true}
        : {ok: false, reason: 'A string output needs a string default.'};
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? {ok: true}
        : {ok: false, reason: 'A number output needs a finite number default.'};
    case 'boolean':
      return typeof value === 'boolean'
        ? {ok: true}
        : {ok: false, reason: 'A boolean output needs a boolean default.'};
    case 'json':
      return validateJsonOutputDefault(declaration);
  }
}

function validateJsonOutputDefault(
  declaration: OutputTypeDeclaration,
): OutputDefaultValidationResult {
  if (!isJsonValue(declaration.default)) {
    return {ok: false, reason: 'A json output needs a JSON default.'};
  }

  if (declaration.schema === undefined) return {ok: true};

  const validate = validatorForJsonOutputSchema(declaration.schema, {coerce: false});
  if (validate({value: declaration.default})) return {ok: true};
  return {
    ok: false,
    reason: `The default does not match the output schema: ${defaultAjv.errorsText(validate.errors, {separator: '; '})}`,
  };
}

export interface CoerceStepOutputOptions {
  /**
   * Parse string values of `json` outputs as JSON text. Runner steps report every
   * output as text, so this defaults to true. Pass false when the reporter already
   * produced typed values, or a string like "1791226001.009789" becomes a number.
   */
  readonly parseJsonText?: boolean;
}

export function coerceStepOutputs(
  params: {
    readonly declarations: OutputDeclarations;
    readonly output: Record<string, unknown> | null | undefined;
  } & CoerceStepOutputOptions,
): CoerceStepOutputsResult {
  const output = params.output ?? {};

  const missing = missingRequiredOutputError(params.declarations, output);
  if (missing !== undefined) return {ok: false, error: missing};

  for (const key of Object.keys(output)) {
    if (Object.hasOwn(params.declarations, key)) continue;
    return {
      ok: false,
      error: {
        key,
        reason: 'undeclared',
        message: `Output "${key}" is not declared by the step output schema.`,
      },
    };
  }

  const coerced: Record<string, unknown> = {};
  for (const [key, declaration] of Object.entries(params.declarations)) {
    if (!Object.hasOwn(output, key)) {
      if (hasOutputDefault(declaration)) coerced[key] = cloneJsonValue(declaration.default);
      continue;
    }
    const value = output[key];
    const result = coerceStepOutputValue(key, declaration, value, params.parseJsonText ?? true);
    if (!result.ok) return result;
    coerced[key] = result.value;
  }

  return {ok: true, output: coerced};
}

// A failed step keeps the outputs it set before failing. Type what matches its
// declaration and drop the rest, so no output error masks the step's own failure.
export function coerceKeptStepOutputs(
  params: {
    readonly declarations: OutputDeclarations;
    readonly output: Record<string, unknown>;
  } & CoerceStepOutputOptions,
): Record<string, unknown> {
  const coerced: Record<string, unknown> = {};
  for (const [key, declaration] of Object.entries(params.declarations)) {
    if (!Object.hasOwn(params.output, key)) continue;
    const result = coerceStepOutputValue(
      key,
      declaration,
      params.output[key],
      params.parseJsonText ?? true,
    );
    if (result.ok) coerced[key] = result.value;
  }
  return coerced;
}

function missingRequiredOutputError(
  declarations: OutputDeclarations,
  output: Record<string, unknown>,
): StepOutputCoercionError | undefined {
  for (const [key, declaration] of Object.entries(declarations)) {
    if (Object.hasOwn(output, key) || declaration.required === false) continue;
    if (hasOutputDefault(declaration)) continue;
    return {
      key,
      reason: 'missing',
      expectedType: declaration.type,
      message: `Output "${key}" is required by the step output declaration.`,
    };
  }
  return undefined;
}

type CoerceStepOutputValueResult =
  | {readonly ok: true; readonly value: unknown}
  | {readonly ok: false; readonly error: StepOutputCoercionError};

function coerceStepOutputValue(
  key: string,
  declaration: OutputTypeDeclaration,
  value: unknown,
  parseJsonText: boolean,
): CoerceStepOutputValueResult {
  switch (declaration.type) {
    case 'string':
      return coerceStringOutput(key, value);
    case 'number':
      return coerceNumberOutput(key, value);
    case 'boolean':
      return coerceBooleanOutput(key, value);
    case 'json':
      return coerceJsonOutput(key, declaration, value, parseJsonText);
  }
}

function coerceStringOutput(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value === 'string') return {ok: true, value};
  return invalidTypeError(key, 'string', 'must be a string');
}

function coerceNumberOutput(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value === 'number' && Number.isFinite(value)) return {ok: true, value};

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      const number = Number(trimmed);
      if (Number.isFinite(number)) return {ok: true, value: number};
    }
  }

  return invalidTypeError(key, 'number', 'must be a finite number or numeric string');
}

function coerceBooleanOutput(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value === 'boolean') return {ok: true, value};
  if (value === 'true') return {ok: true, value: true};
  if (value === 'false') return {ok: true, value: false};
  return invalidTypeError(key, 'boolean', 'must be a boolean or the string "true" or "false"');
}

function coerceJsonOutput(
  key: string,
  declaration: OutputTypeDeclaration,
  value: unknown,
  parseJsonText: boolean,
): CoerceStepOutputValueResult {
  const parsed = parseJsonText ? parseJsonOutputValue(key, value) : {ok: true as const, value};
  if (!parsed.ok) return parsed;

  if (declaration.schema === undefined) return {ok: true, value: parsed.value};

  const data = {value: cloneJsonValue(parsed.value)};
  const validate = validatorForJsonOutputSchema(declaration.schema);
  if (validate(data)) return {ok: true, value: data.value};

  return {
    ok: false,
    error: {
      key,
      reason: 'schema_invalid',
      expectedType: 'json',
      message: `Output "${key}" does not match its JSON Schema.`,
      schemaError: coercingAjv.errorsText(validate.errors, {separator: '; '}),
    },
  };
}

function parseJsonOutputValue(key: string, value: unknown): CoerceStepOutputValueResult {
  if (typeof value !== 'string') return {ok: true, value};

  try {
    return {ok: true, value: JSON.parse(value) as unknown};
  } catch {
    if (looksLikeJsonContainer(value)) {
      return {
        ok: false,
        error: {
          key,
          reason: 'invalid_json',
          expectedType: 'json',
          message: `Output "${key}" must be valid JSON.`,
        },
      };
    }
    return {ok: true, value};
  }
}

function invalidTypeError(
  key: string,
  expectedType: OutputType,
  detail: string,
): CoerceStepOutputValueResult {
  return {
    ok: false,
    error: {
      key,
      reason: 'invalid_type',
      expectedType,
      message: `Output "${key}" ${detail}.`,
    },
  };
}

// Ajv keeps every compiled schema object it sees, so reuse validators by schema content.
function validatorForJsonOutputSchema(
  schema: unknown,
  options: {readonly coerce: boolean} = {coerce: true},
): ValidateFunction {
  const instance = options.coerce ? coercingAjv : defaultAjv;
  const cache = options.coerce ? jsonOutputValidatorCache : jsonDefaultValidatorCache;
  const key = stableJsonStringify(schema);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const validate = instance.compile({
    type: 'object',
    properties: {value: schema},
    required: ['value'],
    additionalProperties: false,
  });
  cache.set(key, validate);
  return validate;
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
    Object.keys(properties).some((field) => !required.includes(field)) ||
    required.some((field) => !Object.hasOwn(properties, field))
  ) {
    return openObjectJsonType;
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

function hasDynamicSchemaShape(schema: Readonly<Record<string, unknown>>): boolean {
  return (
    schema.oneOf !== undefined ||
    schema.anyOf !== undefined ||
    schema.allOf !== undefined ||
    schema.not !== undefined ||
    schema.nullable === true
  );
}

// js-yaml can produce Date instances and cyclic aliases, neither of which is JSON.
function isJsonValue(value: unknown, active: Set<object> = new Set()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object':
      return isJsonContainer(value, active);
    default:
      return false;
  }
}

function isJsonContainer(value: object, active: Set<object>): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  if (active.has(value)) return false;

  active.add(value);
  const valid = Object.values(value).every((child) => isJsonValue(child, active));
  active.delete(value);
  return valid;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return value;
  return JSON.parse(serialized) as unknown;
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainRecord(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])]),
  );
}

function looksLikeJsonContainer(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}
