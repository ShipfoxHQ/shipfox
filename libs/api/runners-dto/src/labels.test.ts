import {canonicalizeRunnerLabels} from './labels.js';

describe('canonicalizeRunnerLabels', () => {
  it('trims, lowercases, dedupes, and sorts labels', () => {
    const result = canonicalizeRunnerLabels([' Linux ', 'x64', 'linux', 'ARM64']);

    expect(result).toEqual(['arm64', 'linux', 'x64']);
  });

  it('drops empty labels after trimming', () => {
    const result = canonicalizeRunnerLabels([' ', '\t', 'linux']);

    expect(result).toEqual(['linux']);
  });

  it('returns stable ordering regardless of input order', () => {
    const first = canonicalizeRunnerLabels(['z', 'a', 'm']);
    const second = canonicalizeRunnerLabels(['m', 'z', 'a']);

    expect(first).toEqual(['a', 'm', 'z']);
    expect(second).toEqual(first);
  });
});
