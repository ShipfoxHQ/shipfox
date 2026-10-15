import {posix} from 'node:path';
import {normalizeRelativePath, parseAnchoredPattern} from './anchored-path.js';

describe('parseAnchoredPattern', () => {
  it.each([
    ['node_modules', 'cwd', 'node_modules'],
    ['~/.npm', 'home', '.npm'],
    ['~//.npm', 'home', '.npm'],
    ['/opt/tools', 'root', 'opt/tools'],
    ['//opt//tools/', 'root', 'opt/tools'],
    ['./dist/', 'cwd', 'dist'],
    ['  ~/x  ', 'home', 'x'],
    ['a/../b', 'cwd', 'b'],
    ['.', 'cwd', '.'],
    ['./', 'cwd', '.'],
    ['~foo', 'cwd', '~foo'],
    ['**/package-lock.json', 'cwd', '**/package-lock.json'],
  ])('anchors %j to %s as %j', (line, anchor, pattern) => {
    expect(parseAnchoredPattern(line)).toEqual({ok: true, anchor, pattern});
  });

  it.each([[''], ['   '], [null], [undefined], [42], [['a']]])('reads %j as empty', (line) => {
    expect(parseAnchoredPattern(line)).toEqual({ok: false, reason: 'empty'});
  });

  it.each([['a\nb'], ['a\0b'], [' ~/a\n.lock ']])('rejects the control character in %j', (line) => {
    expect(parseAnchoredPattern(line)).toEqual({ok: false, reason: 'control-character'});
  });

  it.each([
    ['~', 'home'],
    ['~/', 'home'],
    ['~//', 'home'],
    ['/', 'root'],
    ['///', 'root'],
    ['/tmp/..', 'root'],
    ['~/cache/..', 'home'],
  ])('rejects %j, the whole %s directory', (line, anchor) => {
    expect(parseAnchoredPattern(line)).toEqual({ok: false, reason: 'whole-anchor', anchor});
  });

  it.each([
    ['../outside', 'cwd'],
    ['a/../../outside', 'cwd'],
    ['..', 'cwd'],
    ['../', 'cwd'],
    ['~/../other', 'home'],
    ['/..', 'root'],
    ['/a/../../etc', 'root'],
  ])('rejects %j, which leaves the %s directory', (line, anchor) => {
    expect(parseAnchoredPattern(line)).toEqual({ok: false, reason: 'leaves-anchor', anchor});
  });

  it('keeps a `...` segment, which is a name and not an escape', () => {
    expect(parseAnchoredPattern('.../a')).toEqual({ok: true, anchor: 'cwd', pattern: '.../a'});
  });
});

describe('normalizeRelativePath', () => {
  it.each([
    '',
    '.',
    './',
    '..',
    '../',
    '../..',
    'a',
    'a/',
    'a//b',
    'a/./b',
    'a/../b',
    'a/../../b',
    'a/b/../../..',
    'a/b/../../../',
    '../a/../..',
    '...',
    '.../..',
    '.a/..b/',
    'node_modules',
    '.npm',
    'opt/tools',
    'dist/',
    '**/*.lock',
    '+(a|b).log',
    'with\\slash/../x',
  ])('matches posix.normalize for %j', (path) => {
    expect(normalizeRelativePath(path)).toBe(posix.normalize(path));
  });

  it('matches posix.normalize for every relative path up to 8 characters of `a`, `.`, and `/`', () => {
    const mismatches: string[] = [];
    for (const path of strings(['a', '.', '/'], 8)) {
      if (path.startsWith('/')) continue;
      if (normalizeRelativePath(path) !== posix.normalize(path)) mismatches.push(path);
    }

    expect(mismatches).toEqual([]);
  });
});

function* strings(alphabet: readonly string[], maxLength: number): Generator<string> {
  let current = [''];
  for (let length = 0; length <= maxLength; length += 1) {
    yield* current;
    current = current.flatMap((prefix) => alphabet.map((character) => prefix + character));
  }
}
