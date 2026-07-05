import {
  jsonSchemaToExpressionType,
  outputDeclarationToExpressionType,
  validateJsonSchema,
} from './output-declarations.js';

describe('outputDeclarationToExpressionType', () => {
  it.each([
    [{type: 'string' as const}, 'string'],
    [{type: 'number' as const}, 'double'],
    [{type: 'boolean' as const}, 'bool'],
    [{type: 'json' as const}, {kind: 'map'}],
  ])('maps %j', (declaration, expected) => {
    const result = outputDeclarationToExpressionType(declaration);

    expect(result).toEqual(expected);
  });
});

describe('jsonSchemaToExpressionType', () => {
  it.each([
    [{type: 'string'}, 'string'],
    [{type: 'number'}, 'double'],
    [{type: 'integer'}, 'int'],
    [{type: 'boolean'}, 'bool'],
    [{type: 'null'}, 'null'],
  ])('maps scalar schema %j', (schema, expected) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toEqual(expected);
  });

  it('maps array schemas', () => {
    const result = jsonSchemaToExpressionType({type: 'array', items: {type: 'string'}});

    expect(result).toEqual({kind: 'list', element: 'string'});
  });

  it('maps closed all-required object schemas', () => {
    const result = jsonSchemaToExpressionType({
      type: 'object',
      additionalProperties: false,
      required: ['registry', 'size_bytes'],
      properties: {
        registry: {type: 'string'},
        size_bytes: {type: 'integer'},
      },
    });

    expect(result).toEqual({
      kind: 'object',
      fields: {
        registry: 'string',
        size_bytes: 'int',
      },
    });
  });

  it.each([
    [
      'optional property',
      {
        type: 'object',
        additionalProperties: false,
        required: ['registry'],
        properties: {registry: {type: 'string'}, tag: {type: 'string'}},
      },
    ],
    [
      'additional properties',
      {
        type: 'object',
        additionalProperties: true,
        required: ['registry'],
        properties: {registry: {type: 'string'}},
      },
    ],
    ['oneOf', {oneOf: [{type: 'string'}, {type: 'number'}]}],
    ['anyOf', {anyOf: [{type: 'string'}, {type: 'number'}]}],
    ['enum', {enum: ['a', 'b']}],
    ['nullable', {type: 'string', nullable: true}],
    ['patternProperties', {type: 'object', patternProperties: {'^x': {type: 'string'}}}],
    ['union type', {type: ['string', 'number']}],
  ])('falls back to map for %s schemas', (_label, schema) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toEqual({kind: 'map'});
  });
});

describe('validateJsonSchema', () => {
  it('accepts valid JSON Schemas', () => {
    const result = validateJsonSchema({
      type: 'object',
      properties: {registry: {type: 'string'}},
    });

    expect(result).toEqual({ok: true});
  });

  it('rejects invalid JSON Schemas', () => {
    const result = validateJsonSchema({type: 'definitely-not-a-json-schema-type'});

    expect(result).toMatchObject({ok: false});
  });
});
