import {
  classifyShellSite,
  initialShellScanState,
  type ShellFrame,
  scanShellLiteral,
} from './shell-quoting.js';

describe('shell quoting scanner', () => {
  it.each([
    ['echo ', {kind: 'unquoted'}],
    ["echo '", {kind: 'single'}],
    ['echo "', {kind: 'double'}],
  ] as const)('classifies plain context after %s', (literal, expected) => {
    const state = scanShellLiteral(literal, initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual(expected);
  });

  it('honors backslash escapes in unquoted spans', () => {
    const state = scanShellLiteral("\\'\\`\\$ ", initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unquoted'});
  });

  it('honors backslash escapes in double-quoted spans', () => {
    const state = scanShellLiteral('"quoted \\" still double ', initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'double'});
  });

  it('does not treat backslash as an escape inside single quotes', () => {
    const state = scanShellLiteral("'\\'", initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unquoted'});
  });

  it('carries quote state across mixed spans', () => {
    let state = scanShellLiteral('echo "before ', initialShellScanState);
    state = scanShellLiteral(' after" && echo ', state);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unquoted'});
  });

  it.each([
    ['$((', 'arith'],
    ['((', 'arith'],
    ['$[', 'arith'],
    ['$(', 'paren-sub'],
    ['$( ', 'paren-sub'],
    ['`', 'backtick'],
    ['${', 'param-brace'],
    ["$'", 'dollar-single'],
    ['$"', 'dollar-double'],
    ['cat <<EOF\n', 'heredoc'],
    ['cat <<', 'heredoc'],
  ] as const)('classifies %s as unsafe', (literal, region) => {
    const state = scanShellLiteral(literal, initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unsafe', region});
  });

  it.each([
    'echo \\',
    'echo "prefix\\',
  ])('classifies a dangling escape after %s as unsafe', (literal) => {
    const state = scanShellLiteral(literal, initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unsafe', region: 'escape'});
  });

  it.each([
    ['"${foo:-', 'param-brace'],
    ['"$(echo ', 'paren-sub'],
    ['"$[1 + ', 'arith'],
    ['$[ a[0] + ', 'arith'],
    ['`echo ${', 'param-brace'],
  ] as const)('reports the innermost unsafe region for %s', (literal, region) => {
    const state = scanShellLiteral(literal, initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unsafe', region: region satisfies ShellFrame});
  });

  it.each([
    ...continuedForms('$((').map((prefix) => [`${prefix}1 + `, 'arith'] as const),
    ...continuedForms('$[').map((prefix) => [`${prefix}1 + `, 'arith'] as const),
    ...continuedForms('$(').map((prefix) => [`${prefix}echo `, 'paren-sub'] as const),
    ...continuedForms('${').map((prefix) => [`${prefix}value:-`, 'param-brace'] as const),
    ...continuedForms("$'").map((prefix) => [`${prefix}value`, 'dollar-single'] as const),
    ...continuedForms('$"').map((prefix) => [`${prefix}value`, 'dollar-double'] as const),
    ...continuedForms('((').map((prefix) => [`${prefix}1 + `, 'arith'] as const),
    ...continuedForms('<<').map((prefix) => [`cat ${prefix}EOF\n`, 'heredoc'] as const),
    ...continuedForms('<<-').map((prefix) => [`cat ${prefix}EOF\n`, 'heredoc'] as const),
  ])('reports unsafe regions through line continuations in %s', (literal, region) => {
    const state = scanShellLiteral(literal, initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unsafe', region: region satisfies ShellFrame});
  });

  it('returns to plain context after closed control constructs', () => {
    const state = scanShellLiteral(
      `$(echo ok) ${'$'}{value:-fallback} $((1 + 2)) $[array[0] + 2] `,
      {
        frames: [],
      },
    );

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unquoted'});
  });

  it('ignores quotes inside line comments', () => {
    const state = scanShellLiteral('# "not an open quote"\nprintf ', initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unquoted'});
  });

  it('does not start a line comment after escaped whitespace', () => {
    const state = scanShellLiteral('foo\\ # "unterminated', initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'double'});
  });

  it('preserves escaped whitespace before comments across scan calls', () => {
    let state = scanShellLiteral('foo\\ ', initialShellScanState);
    state = scanShellLiteral('# "unterminated', state);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'double'});
  });

  it('uses the effective previous character after line continuations', () => {
    const state = scanShellLiteral('echo \\\n# "comment only"\nprintf ', initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unquoted'});
  });

  it('does not turn a hash after a continued word into a comment', () => {
    const state = scanShellLiteral('foo\\\n# "unterminated', initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'double'});
  });

  it('does not mutate arithmetic-square frames from previous scan states', () => {
    const original = scanShellLiteral('$[a[', initialShellScanState);

    scanShellLiteral('0] + ', original);

    expect(original.frames).toEqual([{kind: 'arith-square', bracketDepth: 1}]);
  });
});

function continuedForms(operator: string): string[] {
  const forms: string[] = [];
  const slots = operator.length - 1;

  for (let mask = 1; mask < 1 << slots; mask += 1) {
    let form = operator[0] ?? '';
    for (let index = 1; index < operator.length; index += 1) {
      if ((mask & (1 << (index - 1))) !== 0) form += '\\\n';
      form += operator[index];
    }
    forms.push(form);
  }

  return forms;
}
