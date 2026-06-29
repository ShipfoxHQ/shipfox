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
    ['"${foo:-', 'param-brace'],
    ['"$(echo ', 'paren-sub'],
    ['`echo ${', 'param-brace'],
  ] as const)('reports the innermost unsafe region for %s', (literal, region) => {
    const state = scanShellLiteral(literal, initialShellScanState);

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unsafe', region: region satisfies ShellFrame});
  });

  it('returns to plain context after closed control constructs', () => {
    const state = scanShellLiteral(`$(echo ok) ${'$'}{value:-fallback} $((1 + 2)) `, {
      frames: [],
    });

    const result = classifyShellSite(state);

    expect(result).toEqual({kind: 'unquoted'});
  });
});
