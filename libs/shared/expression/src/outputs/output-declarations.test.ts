import {Ajv} from 'ajv';
import {
  coerceKeptStepOutputs,
  coerceStepOutputs,
  jsonSchemaToExpressionType,
  outputDeclarationToExpressionType,
  outputDefaults,
  validateJsonSchema,
  validateOutputDefault,
} from './output-declarations.js';

describe('outputDeclarationToExpressionType', () => {
  it.each([
    [{type: 'string' as const}, 'string'],
    [{type: 'number' as const}, 'double'],
    [{type: 'boolean' as const}, 'bool'],
    [{type: 'json' as const}, {kind: 'dyn'}],
    [{type: 'json' as const, schema: {}}, {kind: 'dyn'}],
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
    [
      'required property without a schema',
      {
        type: 'object',
        additionalProperties: false,
        required: ['registry'],
        properties: {},
      },
    ],
    ['patternProperties', {type: 'object', patternProperties: {'^x': {type: 'string'}}}],
  ])('maps open object %s schema to map', (_label, schema) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toEqual({kind: 'map'});
  });

  it.each([
    ['absent schema', undefined],
    ['null schema', null],
    ['oneOf', {oneOf: [{type: 'string'}, {type: 'number'}]}],
    ['anyOf', {anyOf: [{type: 'string'}, {type: 'number'}]}],
    ['allOf', {allOf: [{type: 'string'}, {type: 'number'}]}],
    ['not', {not: {type: 'string'}}],
    ['nullable', {type: 'string', nullable: true}],
    ['union type', {type: ['string', 'number']}],
    ['empty schema', {}],
  ])('maps unknown-shaped %s schema to dyn', (_label, schema) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toEqual({kind: 'dyn'});
  });

  it.each([
    [{type: 'string', enum: ['ready']}, 'string'],
    [{type: 'integer', const: 42}, 'int'],
    [{type: 'number', enum: [1, 2]}, 'double'],
  ])('preserves scalar schema %j despite enum/const', (schema, expected) => {
    const result = jsonSchemaToExpressionType(schema);

    expect(result).toBe(expected);
  });

  it('maps an unconstrained nested schema to dyn', () => {
    const result = jsonSchemaToExpressionType({
      type: 'object',
      additionalProperties: false,
      properties: {payload: {}},
      required: ['payload'],
    });

    expect(result).toEqual({kind: 'object', fields: {payload: {kind: 'dyn'}}});
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

describe('coerceStepOutputs', () => {
  it('passes through scalar and structured values for schema-less JSON outputs', () => {
    const result = coerceStepOutputs({
      declarations: {
        count: {type: 'json'},
        ready: {type: 'json'},
        payload: {type: 'json'},
        items: {type: 'json'},
      },
      output: {
        count: 42,
        ready: true,
        payload: {name: 'build'},
        items: ['one', 2],
      },
    });

    expect(result).toEqual({
      ok: true,
      output: {
        count: 42,
        ready: true,
        payload: {name: 'build'},
        items: ['one', 2],
      },
    });
  });

  it('decodes string values for schema-less JSON outputs', () => {
    const result = coerceStepOutputs({
      declarations: {
        count: {type: 'json'},
        ready: {type: 'json'},
        payload: {type: 'json'},
        items: {type: 'json'},
      },
      output: {
        count: '42',
        ready: 'true',
        payload: '{"name":"build"}',
        items: '["one",2]',
      },
    });

    expect(result).toEqual({
      ok: true,
      output: {
        count: 42,
        ready: true,
        payload: {name: 'build'},
        items: ['one', 2],
      },
    });
  });

  it('keeps string values for JSON outputs when the reporter already typed them', () => {
    const output = {
      ts: '1791226001.009789',
      id: '12345678901234567890',
      flag: 'true',
      payload: '{"name":"build"}',
    };

    const result = coerceStepOutputs({
      declarations: {
        ts: {type: 'json'},
        id: {type: 'json'},
        flag: {type: 'json'},
        payload: {type: 'json'},
      },
      output,
      parseJsonText: false,
    });

    expect(result).toEqual({ok: true, output});
  });

  it('still validates JSON schemas when text parsing is off', () => {
    const result = coerceStepOutputs({
      declarations: {ts: {type: 'json', schema: {type: 'string'}}},
      output: {ts: '1791226001.009789'},
      parseJsonText: false,
    });

    expect(result).toEqual({ok: true, output: {ts: '1791226001.009789'}});
  });

  it('rejects a value that misses its JSON schema when text parsing is off', () => {
    const result = coerceStepOutputs({
      declarations: {ts: {type: 'json', schema: {type: 'object'}}},
      output: {ts: '1791226001.009789'},
      parseJsonText: false,
    });

    expect(result).toMatchObject({ok: false, error: {key: 'ts', reason: 'schema_invalid'}});
  });

  it('coerces declared scalar output values', () => {
    const result = coerceStepOutputs({
      declarations: {
        count: {type: 'number'},
        ready: {type: 'boolean'},
        sha: {type: 'string'},
      },
      output: {count: '42', ready: 'true', sha: 'abc123'},
    });

    expect(result).toEqual({
      ok: true,
      output: {count: 42, ready: true, sha: 'abc123'},
    });
  });

  it('coerces JSON string output through its schema', () => {
    const result = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {
            type: 'object',
            properties: {
              size: {type: 'integer'},
              ready: {type: 'boolean'},
            },
            required: ['size', 'ready'],
            additionalProperties: false,
          },
        },
      },
      output: {payload: '{"size":"42","ready":"false"}'},
    });

    expect(result).toEqual({
      ok: true,
      output: {payload: {size: 42, ready: false}},
    });
  });

  it('coerces a copied JSON value without mutating the reported output object', () => {
    const payload = {size: '42'};

    const result = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {
            type: 'object',
            properties: {size: {type: 'integer'}},
            required: ['size'],
            additionalProperties: false,
          },
        },
      },
      output: {payload},
    });

    expect(result).toEqual({ok: true, output: {payload: {size: 42}}});
    expect(payload).toEqual({size: '42'});
  });

  it.each([
    ['missing declared key', {count: {type: 'number'}}, {}, {key: 'count', reason: 'missing'}],
    [
      'undeclared emitted key',
      {count: {type: 'number'}},
      {count: '1', extra: 'nope'},
      {key: 'extra', reason: 'undeclared'},
    ],
    [
      'invalid scalar',
      {count: {type: 'number'}},
      {count: 'not-a-number'},
      {key: 'count', reason: 'invalid_type'},
    ],
    [
      'invalid JSON',
      {payload: {type: 'json'}},
      {payload: '{not-json'},
      {key: 'payload', reason: 'invalid_json'},
    ],
    [
      'schema validation failure',
      {
        payload: {
          type: 'json',
          schema: {
            type: 'object',
            properties: {size: {type: 'integer'}},
            required: ['size'],
            additionalProperties: false,
          },
        },
      },
      {payload: '{"size":"not-an-int"}'},
      {key: 'payload', reason: 'schema_invalid'},
    ],
  ] as const)('fails for %s', (_label, declarations, output, expectedError) => {
    const result = coerceStepOutputs({declarations, output});

    expect(result).toMatchObject({ok: false, error: expectedError});
  });

  it('fails on a missing key when the declaration sets required: true', () => {
    const result = coerceStepOutputs({
      declarations: {count: {type: 'number', required: true}},
      output: {},
    });

    expect(result).toMatchObject({ok: false, error: {key: 'count', reason: 'missing'}});
  });

  it('fills a missing output from its default instead of failing', () => {
    const result = coerceStepOutputs({
      declarations: {
        sha: {type: 'string'},
        outcome: {type: 'string', default: 'none'},
        retries: {type: 'number', default: 0},
        ready: {type: 'boolean', default: false},
        meta: {type: 'json', default: {tags: []}},
      },
      output: {sha: 'abc123'},
    });

    expect(result).toEqual({
      ok: true,
      output: {sha: 'abc123', outcome: 'none', retries: 0, ready: false, meta: {tags: []}},
    });
  });

  it('keeps a reported value over the default and still fails a missing output without one', () => {
    const declarations = {
      outcome: {type: 'string', default: 'none'},
      sha: {type: 'string'},
    } as const;

    expect(coerceStepOutputs({declarations, output: {sha: 'a', outcome: 'ok'}})).toEqual({
      ok: true,
      output: {sha: 'a', outcome: 'ok'},
    });
    expect(coerceStepOutputs({declarations, output: {outcome: 'ok'}})).toMatchObject({
      ok: false,
      error: {key: 'sha', reason: 'missing'},
    });
  });

  it('accepts a missing optional output without adding the key', () => {
    const result = coerceStepOutputs({
      declarations: {
        sha: {type: 'string'},
        count: {type: 'number', required: false},
      },
      output: {sha: 'abc123'},
    });

    expect(result).toEqual({ok: true, output: {sha: 'abc123'}});
  });

  it('coerces an optional output that is present', () => {
    const result = coerceStepOutputs({
      declarations: {count: {type: 'number', required: false}},
      output: {count: '42'},
    });

    expect(result).toEqual({ok: true, output: {count: 42}});
  });

  it.each([
    ['invalid scalar', {type: 'number', required: false}, 'not-a-number', 'invalid_type'],
    [
      'schema validation failure',
      {
        type: 'json',
        required: false,
        schema: {type: 'object', properties: {size: {type: 'integer'}}, required: ['size']},
      },
      '{"size":"not-an-int"}',
      'schema_invalid',
    ],
  ] as const)('type-checks a present optional output (%s)', (_label, declaration, value, reason) => {
    const result = coerceStepOutputs({
      declarations: {payload: declaration},
      output: {payload: value},
    });

    expect(result).toMatchObject({ok: false, error: {key: 'payload', reason}});
  });

  it('rejects undeclared keys alongside optional outputs', () => {
    const result = coerceStepOutputs({
      declarations: {count: {type: 'number', required: false}},
      output: {extra: 'nope'},
    });

    expect(result).toMatchObject({ok: false, error: {key: 'extra', reason: 'undeclared'}});
  });

  it('reuses compiled JSON Schema validators by stable schema content', () => {
    const compileSpy = vi.spyOn(Ajv.prototype, 'compile');
    compileSpy.mockClear();

    const first = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {title: 'cache-test-schema', type: 'integer'},
        },
      },
      output: {payload: '1'},
    });
    const second = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {type: 'integer', title: 'cache-test-schema'},
        },
      },
      output: {payload: '2'},
    });

    expect(first).toEqual({ok: true, output: {payload: 1}});
    expect(second).toEqual({ok: true, output: {payload: 2}});
    expect(compileSpy).toHaveBeenCalledTimes(1);
    compileSpy.mockRestore();
  });

  it('does not collide when different JSON Schemas reuse the same schema id', () => {
    const first = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {$id: 'https://shipfox.dev/schemas/output', type: 'integer'},
        },
      },
      output: {payload: '1'},
    });
    const second = coerceStepOutputs({
      declarations: {
        payload: {
          type: 'json',
          schema: {
            $id: 'https://shipfox.dev/schemas/output',
            type: 'object',
            properties: {name: {type: 'string'}},
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      output: {payload: '{"name":"artifact"}'},
    });

    expect(first).toEqual({ok: true, output: {payload: 1}});
    expect(second).toEqual({ok: true, output: {payload: {name: 'artifact'}}});
  });
});

describe('coerceKeptStepOutputs', () => {
  it('types kept outputs and drops invalid, undeclared, and missing ones', () => {
    const result = coerceKeptStepOutputs({
      declarations: {
        path: {type: 'string'},
        complete: {type: 'boolean'},
        count: {type: 'number'},
        missing: {type: 'string', required: true},
      },
      output: {path: 'export.md', complete: 'false', count: 'many', extra: 'nope'},
    });

    expect(result).toEqual({path: 'export.md', complete: false});
  });
});

describe('validateOutputDefault', () => {
  it.each([
    {type: 'string', default: 'none'},
    {type: 'string', default: ''},
    {type: 'number', default: 0},
    {type: 'boolean', default: false},
    {type: 'json', default: null},
    {type: 'json', default: {tags: ['a']}},
    {type: 'json', schema: {type: 'array', items: {type: 'string'}}, default: []},
    {type: 'json', schema: {type: 'string'}, default: '3'},
    {type: 'string'},
  ] as const)('accepts $type default $default', (declaration) => {
    expect(validateOutputDefault(declaration)).toEqual({ok: true});
  });

  it.each([
    {type: 'string', default: 1},
    {type: 'number', default: '3'},
    {type: 'number', default: Number.NaN},
    {type: 'boolean', default: 'false'},
    {type: 'json', default: () => 1},
    {type: 'json', schema: {type: 'array'}, default: 'x'},
    {type: 'json', schema: {type: 'number'}, default: '3'},
    {type: 'json', schema: {type: 'string'}, default: 3},
    {type: 'json', default: new Date('2026-10-07')},
  ] as const)('rejects $type default $default', (declaration) => {
    expect(validateOutputDefault(declaration)).toMatchObject({ok: false});
  });
});

describe('validateOutputDefault with cyclic values', () => {
  it('rejects a cyclic json default instead of overflowing the stack', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);

    expect(validateOutputDefault({type: 'json', default: cyclic})).toMatchObject({ok: false});
  });

  it('accepts a value that appears twice without a cycle', () => {
    const shared = {a: 1};

    expect(validateOutputDefault({type: 'json', default: [shared, shared]})).toEqual({ok: true});
  });
});

describe('outputDefaults', () => {
  it('returns only the declared defaults', () => {
    expect(
      outputDefaults({
        sha: {type: 'string'},
        outcome: {type: 'string', default: 'none'},
        meta: {type: 'json', default: null},
      }),
    ).toEqual({outcome: 'none', meta: null});
    expect(outputDefaults(undefined)).toEqual({});
  });

  it('keeps a __proto__ output key as an own property', () => {
    const declarations = JSON.parse('{"__proto__": {"type": "string", "default": "x"}}');

    const defaults = outputDefaults(declarations);

    expect(Object.hasOwn(defaults, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(defaults)).toBe(Object.prototype);
  });
});
