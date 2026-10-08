import {
  mergeCarriedEnv,
  parseCarriedEnv,
  parseCarriedPath,
  prependPath,
} from '#core/carried-env.js';
import {MAX_OUTPUT_VALUE_BYTES} from '#core/step-output.js';

describe('parseCarriedEnv', () => {
  it('reads KEY=value lines and heredocs', () => {
    const env = parseCarriedEnv('A=1\nB=x=y\nC<<EOF\nline one\nline two\nEOF\n');

    expect(env).toEqual({A: '1', B: 'x=y', C: 'line one\nline two'});
  });

  it('lets a later line override an earlier one', () => {
    expect(parseCarriedEnv('A=1\nA=2')).toEqual({A: '2'});
  });

  it.each(['PATH', 'SHIPFOX_OUTPUT', 'SHIPFOX_CUSTOM'])('rejects %s', (name) => {
    expect(() => parseCarriedEnv(`${name}=x`)).toThrow(`"${name}"`);
  });

  it('accepts a name that merely contains SHIPFOX_', () => {
    expect(parseCarriedEnv('MY_SHIPFOX_VAR=1')).toEqual({MY_SHIPFOX_VAR: '1'});
  });

  it.each([
    ['a line without a separator', 'nonsense', 'Env file contains a malformed line.'],
    ['a name with a dash', 'A-B=1', 'Env file contains an invalid key.'],
    ['a name that starts with a digit', '1A=1', 'Env file contains an invalid key.'],
    ['an empty delimiter', 'A<<', 'Env "A" has an empty delimiter.'],
    ['an unterminated heredoc', 'A<<EOF\nbody', 'Env "A" heredoc is unterminated.'],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseCarriedEnv(raw)).toThrow(message);
  });

  it('rejects a value over the per-value limit', () => {
    expect(() => parseCarriedEnv(`A=${'x'.repeat(MAX_OUTPUT_VALUE_BYTES + 1)}`)).toThrow(
      'Env "A" exceeds the per-value size limit',
    );
  });
});

describe('parseCarriedPath', () => {
  it('keeps absolute directories and resolves relative ones against the working directory', () => {
    expect(parseCarriedPath('/opt/bin\nvendor/bin\n\n', '/work/repo')).toEqual([
      '/opt/bin',
      '/work/repo/vendor/bin',
    ]);
  });

  it('reads CRLF files', () => {
    expect(parseCarriedPath('/a\r\n/b\r\n', '/work')).toEqual(['/a', '/b']);
  });

  it('returns nothing for blank content', () => {
    expect(parseCarriedPath('\n  \n', '/work')).toEqual([]);
  });
});

describe('mergeCarriedEnv', () => {
  it('lets a later step override a value and puts its directories first', () => {
    const merged = mergeCarriedEnv([
      {env: {A: '1', B: '1'}, path: ['/first/a', '/first/b']},
      {env: {B: '2'}, path: ['/second']},
    ]);

    expect(merged).toEqual({env: {A: '1', B: '2'}, path: ['/second', '/first/b', '/first/a']});
  });

  it('lists a directory once, at its latest position', () => {
    const merged = mergeCarriedEnv([
      {env: {}, path: ['/shared', '/first']},
      {env: {}, path: ['/shared']},
    ]);

    expect(merged.path).toEqual(['/shared', '/first']);
  });
});

describe('prependPath', () => {
  it('puts the directories in front of the current PATH', () => {
    expect(prependPath(['/a', '/b'], '/usr/bin')).toBe('/a:/b:/usr/bin');
  });

  it('does not leave a trailing separator when PATH is unset', () => {
    expect(prependPath(['/a'], undefined)).toBe('/a');
  });
});
