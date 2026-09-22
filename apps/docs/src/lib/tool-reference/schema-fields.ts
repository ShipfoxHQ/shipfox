import {inlineCode} from '@/lib/markdown';
import type {
  ToolFieldRequirement,
  ToolReferenceField,
  ToolReferenceVariant,
} from '@/lib/tool-reference/document';

export type JsonSchema = Record<string, unknown>;

interface FieldRow {
  field: ToolReferenceField;
  conditional: boolean;
}

export function schemaFields(schema: JsonSchema, prefix = ''): ToolReferenceField[] {
  return dedupeRows(objectRows(schema, prefix)).map((row) => row.field);
}

/** Splits a schema that is only a union of object shapes into one field list per shape. */
export function schemaVariants(schema: JsonSchema): ToolReferenceVariant[] | undefined {
  if (Object.keys(object(schema.properties)).length > 0) return undefined;
  const options = unionOptions(schema).filter(
    (option) => Object.keys(object(option.properties)).length > 0,
  );
  if (options.length === 0) return undefined;
  return options.map((option) => ({
    title: strings(option.required).map(inlineCode).join(', '),
    fields: schemaFields(option),
  }));
}

/** Required field names from `anyOf` alternatives on an object schema. */
export function schemaAlternatives(schema: JsonSchema): string[][] | undefined {
  const alternatives = objects(schema.anyOf)
    .map((option) => strings(option.required))
    .filter((required) => required.length > 0);
  return alternatives.length > 0 ? alternatives : undefined;
}

function objectRows(schema: JsonSchema, prefix: string): FieldRow[] {
  const properties = object(schema.properties);
  const required = new Set(strings(schema.required));
  const conditional = new Set(
    [...objects(schema.oneOf), ...objects(schema.anyOf)].flatMap((option) =>
      strings(option.required),
    ),
  );
  return Object.entries(properties).map(([name, raw]) => {
    let requirement: ToolFieldRequirement = 'optional';
    if (required.has(name)) requirement = 'required';
    else if (conditional.has(name)) requirement = 'conditional';
    return {
      field: fieldFor(name, `${prefix}${name}`, object(raw), requirement),
      conditional: false,
    };
  });
}

function fieldFor(
  name: string,
  path: string,
  property: JsonSchema,
  requirement: ToolFieldRequirement,
): ToolReferenceField {
  const {schema, nullable} = unwrapNullable(property);
  const description =
    stringOrUndefined(property.description) ?? stringOrUndefined(schema.description);
  const enumValues = Array.isArray(schema.enum) ? schema.enum.map(String) : undefined;
  const constraints = constraintsText(schema);
  const children = childRows(schema, path);
  return {
    name,
    path,
    type: typeText(schema, nullable),
    requirement,
    ...(description ? {description} : {}),
    ...(enumValues && enumValues.length > 0 ? {enumValues} : {}),
    ...(constraints ? {constraints} : {}),
    ...(children.length > 0 ? {children} : {}),
  };
}

function childRows(schema: JsonSchema, path: string): ToolReferenceField[] {
  const nested =
    schema.type === 'array'
      ? {suffix: '[].', shapes: objectShapes(unwrapNullable(object(schema.items)).schema)}
      : {suffix: '.', shapes: objectShapes(schema)};
  const rows = nested.shapes.flatMap((shape) =>
    objectRows(shape.schema, `${path}${nested.suffix}`).map((row) =>
      shape.conditional ? {...row, conditional: true} : row,
    ),
  );
  return dedupeRows(rows).map((row) => row.field);
}

function objectShapes(schema: JsonSchema): {schema: JsonSchema; conditional: boolean}[] {
  if (Object.keys(object(schema.properties)).length > 0) return [{schema, conditional: false}];
  return unionOptions(schema)
    .filter((option) => Object.keys(object(option.properties)).length > 0)
    .map((option) => ({schema: option, conditional: true}));
}

function unionOptions(schema: JsonSchema): JsonSchema[] {
  const options = objects(schema.anyOf).length > 0 ? objects(schema.anyOf) : objects(schema.oneOf);
  return options.map((option) => unwrapNullable(option).schema);
}

// Union shapes can repeat a path; keep one row and widen its type and requirement.
function dedupeRows(rows: FieldRow[]): FieldRow[] {
  const byPath = new Map<string, FieldRow>();
  for (const row of rows) {
    const existing = byPath.get(row.field.path);
    if (!existing) {
      byPath.set(row.field.path, {
        conditional: row.conditional,
        field: {
          ...row.field,
          requirement: row.conditional ? 'conditional' : row.field.requirement,
        },
      });
      continue;
    }
    existing.field.type = mergeUnique(existing.field.type, row.field.type, ' | ');
    existing.field.constraints = mergeOptional(
      existing.field.constraints,
      row.field.constraints,
      ' ',
    );
    existing.field.description ??= row.field.description;
    if (existing.field.requirement !== row.field.requirement || row.conditional) {
      existing.field.requirement = 'conditional';
    }
  }
  return [...byPath.values()];
}

function mergeUnique(left: string, right: string, separator: string): string {
  if (left === right) return left;
  return left.split(separator).includes(right) ? left : `${left}${separator}${right}`;
}

function mergeOptional(
  left: string | undefined,
  right: string | undefined,
  separator: string,
): string | undefined {
  if (!right) return left;
  if (!left) return right;
  return mergeUnique(left, right, separator);
}

function unwrapNullable(property: JsonSchema): {schema: JsonSchema; nullable: boolean} {
  const branches = objects(property.anyOf);
  const nullBranch = branches.find((branch) => branch.type === 'null');
  const valueBranch = branches.find((branch) => branch !== nullBranch);
  if (branches.length === 2 && nullBranch && valueBranch) {
    return {schema: valueBranch, nullable: true};
  }
  if (Array.isArray(property.type) && property.type.includes('null')) {
    const types = property.type.filter((type) => type !== 'null');
    return {schema: {...property, type: types.length === 1 ? types[0] : types}, nullable: true};
  }
  return {schema: property, nullable: false};
}

function typeText(schema: JsonSchema, nullable: boolean): string {
  const base = baseTypeText(schema);
  return nullable ? `${base} | null` : base;
}

function baseTypeText(schema: JsonSchema): string {
  if ('const' in schema) return `constant ${JSON.stringify(schema.const)}`;
  const options = unionOptions(schema);
  if (options.length > 0) return unionTypeText(options);
  if (schema.type === 'array') {
    const items = schema.items ? unwrapNullable(object(schema.items)).schema : undefined;
    return items && Object.keys(items).length > 0 ? `array of ${baseTypeText(items)}` : 'array';
  }
  if (schema.type === 'string') return stringTypeText(schema);
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  return 'any JSON value';
}

function unionTypeText(options: JsonSchema[]): string {
  if (options.every((option) => Object.keys(object(option.properties)).length > 0)) {
    return `object (one of ${options.length} shapes)`;
  }
  return options.map(baseTypeText).join(' | ');
}

function stringTypeText(schema: JsonSchema): string {
  if (typeof schema.format === 'string') return `string (${schema.format})`;
  if (schema.contentMediaType === 'application/json') return 'string (serialized JSON)';
  return 'string';
}

function constraintsText(schema: JsonSchema): string | undefined {
  const parts: string[] = [];
  if (typeof schema.minimum === 'number') parts.push(`Minimum ${formatNumber(schema.minimum)}.`);
  if (typeof schema.maximum === 'number') parts.push(`Maximum ${formatNumber(schema.maximum)}.`);
  if (typeof schema.minLength === 'number') {
    parts.push(`Minimum length ${formatNumber(schema.minLength)}.`);
  }
  if (typeof schema.maxLength === 'number') {
    parts.push(`Maximum length ${formatNumber(schema.maxLength)}.`);
  }
  parts.push(...itemCountConstraints(schema));
  if (schema.default !== undefined) parts.push(`Default ${JSON.stringify(schema.default)}.`);
  if (schema.type === 'array') {
    const itemConstraints = constraintsText(unwrapNullable(object(schema.items)).schema);
    if (itemConstraints) parts.push(`Each item: ${lowercaseFirst(itemConstraints)}`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function itemCountConstraints(schema: JsonSchema): string[] {
  const {minItems, maxItems} = schema;
  const hasMin = typeof minItems === 'number';
  const hasMax = typeof maxItems === 'number';
  if (hasMin && hasMax && minItems === maxItems) return [`Exactly ${formatItemCount(minItems)}.`];
  return [
    ...(hasMin ? [`Minimum ${formatItemCount(minItems)}.`] : []),
    ...(hasMax ? [`Maximum ${formatItemCount(maxItems)}.`] : []),
  ];
}

function formatItemCount(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'item' : 'items'}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function object(value: unknown): JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : {};
}

export function objects(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? value.map(object) : [];
}

export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
