import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MAX_STATE_BYTES} from '#contract.js';
import {ActionStateError, createActionState, parseStateFile} from '#state.js';

describe('parseStateFile', () => {
  it('keeps the last value of a repeated name and skips blank lines', () => {
    const values = parseStateFile('{"name":"a","value":"1"}\n\n{"name":"a","value":"2"}\n');

    expect([...values]).toEqual([['a', '2']]);
  });
});

describe('createActionState', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shipfox-state-'));
    path = join(dir, 'state');
    writeFileSync(path, '');
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  it('appends the set value to the file and reads it back', () => {
    const state = createActionState(path);

    state.set('key', 'line\nbreak');

    expect(state.get('key')).toBe('line\nbreak');
    expect(readFileSync(path, 'utf8')).toBe('{"name":"key","value":"line\\nbreak"}\n');
  });

  it('answers from the seeded file', () => {
    writeFileSync(path, '{"name":"seed","value":"v"}\n');

    expect(createActionState(path).get('seed')).toBe('v');
  });

  it('rejects a name that is not an identifier', () => {
    expect(() => createActionState(path).set('a-b', 'x')).toThrow(ActionStateError);
  });

  it('rejects a value that is not a string', () => {
    expect(() => createActionState(path).set('n', 1 as unknown as string)).toThrow(
      'must be a string',
    );
  });

  it('rejects a write past the size limit and leaves the file unchanged', () => {
    const state = createActionState(path);

    expect(() => state.set('big', 'x'.repeat(MAX_STATE_BYTES))).toThrow(ActionStateError);
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  it('counts the seed toward the size limit', () => {
    writeFileSync(
      path,
      `${JSON.stringify({name: 'seed', value: 'x'.repeat(MAX_STATE_BYTES - 40)})}\n`,
    );

    expect(() => createActionState(path).set('more', 'x'.repeat(100))).toThrow(ActionStateError);
  });

  it('fails set without a state file', () => {
    expect(() => createActionState(undefined).set('a', 'b')).toThrow('SHIPFOX_STATE');
  });
});
