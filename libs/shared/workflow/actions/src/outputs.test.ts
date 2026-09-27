import type {ActionOutputDeclarations} from '#contract.js';
import {
  ActionOutputError,
  createActionOutputs,
  encodeOutputValue,
  formatOutputEntry,
} from '#outputs.js';

const SERIALIZE_ERROR_RE = /Output "out" is declared as json but cannot be serialized/;
const HEREDOC_DELIMITER_RE = /^SHIPFOX_OUTPUT_[0-9a-f-]{36}$/;

describe('encodeOutputValue', () => {
  it.each([
    ['true', '"true"'],
    ['123', '"123"'],
    ['null', '"null"'],
    ['[1]', '"[1]"'],
    ['', '""'],
  ])('keeps the string %j a string through a json output', (value, expected) => {
    const encoded = encodeOutputValue({name: 'out', declaration: {type: 'json'}, value});

    expect(encoded).toBe(expected);
    expect(JSON.parse(encoded)).toBe(value);
  });

  it.each([
    [{a: [1, null]}, '{"a":[1,null]}'],
    [[1, 'x'], '[1,"x"]'],
    [42, '42'],
    [false, 'false'],
    [null, 'null'],
  ])('stringifies the json value %j', (value, expected) => {
    const encoded = encodeOutputValue({name: 'out', declaration: {type: 'json'}, value});

    expect(encoded).toBe(expected);
  });

  it.each([
    [{type: 'string'}, 'hello', 'hello'],
    [{type: 'string'}, '', ''],
    [{type: 'number'}, 1.5, '1.5'],
    [{type: 'number'}, 0, '0'],
    [{type: 'boolean'}, true, 'true'],
    [{type: 'boolean'}, false, 'false'],
  ] as const)('writes a %j output value %j as %j', (declaration, value, expected) => {
    const encoded = encodeOutputValue({name: 'out', declaration, value});

    expect(encoded).toBe(expected);
  });

  it.each([
    [{type: 'string'}, 1, 'Output "out" is declared as string but got a number.'],
    [{type: 'number'}, '1', 'Output "out" is declared as number but got a string.'],
    [{type: 'number'}, Number.NaN, 'Output "out" is declared as number but got NaN.'],
    [{type: 'boolean'}, 'true', 'Output "out" is declared as boolean but got a string.'],
    [{type: 'string'}, undefined, 'Output "out" is declared as string but got undefined.'],
    [{type: 'json'}, undefined, 'Output "out" is declared as json but got undefined.'],
    [{type: 'json'}, () => 1, 'Output "out" is declared as json but got a function.'],
  ] as const)('rejects a %j output value %j', (declaration, value, message) => {
    const encode = () => encodeOutputValue({name: 'out', declaration, value});

    expect(encode).toThrow(ActionOutputError);
    expect(encode).toThrow(message);
  });

  it.each([
    ['a BigInt', 1n],
    ['a cycle', cyclicValue()],
    ['a nested NaN', {count: Number.NaN}],
  ])('rejects %s in a json output', (_label, value) => {
    const encode = () => encodeOutputValue({name: 'out', declaration: {type: 'json'}, value});

    expect(encode).toThrow(SERIALIZE_ERROR_RE);
  });

  it('rejects an undeclared output', () => {
    const encode = () => encodeOutputValue({name: 'extra', declaration: undefined, value: 'x'});

    expect(encode).toThrow('Output "extra" is not declared in action.yml.');
  });
});

describe('formatOutputEntry', () => {
  it('writes a single-line value as name=value', () => {
    expect(formatOutputEntry('path', 'context/a.md')).toBe('path=context/a.md\n');
  });

  it('writes a multi-line value with a heredoc delimiter', () => {
    const entry = formatOutputEntry('body', 'line 1\nline 2');

    const [start, ...rest] = entry.split('\n');
    const delimiter = start?.slice('body<<'.length);
    expect(delimiter).toMatch(HEREDOC_DELIMITER_RE);
    expect(rest).toEqual(['line 1', 'line 2', delimiter, '']);
  });
});

describe('createActionOutputs', () => {
  const declarations: ActionOutputDeclarations = {
    path: {type: 'string'},
    message_count: {type: 'number', required: true},
    complete: {type: 'boolean', required: false},
    data: {type: 'json', required: false},
  };

  it('returns the entry to append when an output is set', () => {
    const outputs = createActionOutputs(declarations);

    const entry = outputs.set('message_count', 3);

    expect(entry).toBe('message_count=3\n');
  });

  it('merges the returned object over values set earlier', () => {
    const outputs = createActionOutputs(declarations);
    outputs.set('path', 'first.md');
    outputs.set('message_count', 1);

    const content = outputs.finish({path: 'second.md'});

    expect(content).toBe('path=second.md\nmessage_count=1\n');
  });

  it('allows optional outputs to stay unset', () => {
    const outputs = createActionOutputs(declarations);

    const content = outputs.finish({path: 'a.md', message_count: 2});

    expect(content).toBe('path=a.md\nmessage_count=2\n');
  });

  it('type-checks optional outputs when they are set', () => {
    const outputs = createActionOutputs(declarations);

    const finish = () => outputs.finish({path: 'a.md', message_count: 2, complete: 'yes'});

    expect(finish).toThrow('Output "complete" is declared as boolean but got a string.');
  });

  it('treats a declaration without required as required', () => {
    const outputs = createActionOutputs(declarations);

    const finish = () => outputs.finish({message_count: 2});

    expect(finish).toThrow('Required output "path" was not set.');
  });

  it('names every missing required output', () => {
    const outputs = createActionOutputs(declarations);

    const finish = () => outputs.finish(undefined);

    expect(finish).toThrow('Required outputs "path", "message_count" were not set.');
  });

  it('rejects an undeclared key in the returned object', () => {
    const outputs = createActionOutputs(declarations);

    const finish = () => outputs.finish({path: 'a.md', message_count: 1, extra: true});

    expect(finish).toThrow('Output "extra" is not declared in action.yml.');
  });

  it('does not treat inherited object keys as declarations', () => {
    const outputs = createActionOutputs(declarations);

    const set = () => outputs.set('toString', 'x');

    expect(set).toThrow('Output "toString" is not declared in action.yml.');
  });

  it.each([
    ['null', null],
    ['an array', ['a.md']],
    ['a string', 'a.md'],
  ])('rejects %s as the returned value', (_label, returned) => {
    const outputs = createActionOutputs(declarations);

    const finish = () => outputs.finish(returned);

    expect(finish).toThrow('The action handler must return an object of outputs, or nothing.');
  });

  it('keeps json strings as strings in the file content', () => {
    const outputs = createActionOutputs({data: {type: 'json'}});

    const content = outputs.finish({data: 'true'});

    expect(content).toBe('data="true"\n');
  });
});

function cyclicValue(): unknown {
  const value: Record<string, unknown> = {};
  value.self = value;
  return value;
}
