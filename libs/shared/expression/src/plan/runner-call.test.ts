import {analyzeRunnerCalls, referencesRunnerCall} from './runner-call.js';

describe('analyzeRunnerCalls', () => {
  it('returns the patterns of a bare hashFiles() call', () => {
    const analysis = analyzeRunnerCalls("hashFiles('**/package-lock.json', 'pnpm-workspace.yaml')");

    expect(analysis).toEqual({
      kind: 'bare',
      call: {function: 'hashFiles', patterns: ['**/package-lock.json', 'pnpm-workspace.yaml']},
    });
  });

  it.each([
    '"npm-" + hashFiles("x")',
    'size(hashFiles("x")) > 0',
    'runner.os == "linux" ? hashFiles("a") : "b"',
    '[hashFiles("x")]',
  ])('reports a call nested in a larger expression: %s', (source) => {
    const analysis = analyzeRunnerCalls(source);

    expect(analysis).toEqual({kind: 'not-bare', function: 'hashFiles'});
  });

  it.each([
    'hashFiles(vars.LOCK)',
    'hashFiles("a" + "b")',
    'hashFiles(1)',
  ])('reports a non-literal argument: %s', (source) => {
    const analysis = analyzeRunnerCalls(source);

    expect(analysis).toEqual({kind: 'argument-not-literal', function: 'hashFiles'});
  });

  it.each([
    'hashFiles()',
    `hashFiles(${Array.from({length: 17}, () => '"x"').join(', ')})`,
  ])('reports the wrong number of patterns: %s', (source) => {
    expect(analyzeRunnerCalls(source)).toEqual({kind: 'arity', function: 'hashFiles'});
  });

  it.each([
    'toJson(event)',
    'runner.os',
    'event.hashFiles',
    'event.items.hashFiles()',
  ])('finds no runner call in %s', (source) => {
    expect(referencesRunnerCall(source)).toBe(false);
  });
});
