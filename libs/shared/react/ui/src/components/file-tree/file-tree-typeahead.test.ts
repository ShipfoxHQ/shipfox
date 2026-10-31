import {findTypeaheadMatch} from './file-tree-typeahead.js';

const names = ['actions', 'agents', 'implement.yml', 'Workflows', 'worker.yml'];

describe('findTypeaheadMatch', () => {
  test('finds the next name after the current one', () => {
    const match = findTypeaheadMatch({names, from: 0, query: 'a'});

    expect(match).toBe(1);
  });

  test('wraps past the last name', () => {
    const match = findTypeaheadMatch({names, from: 4, query: 'a'});

    expect(match).toBe(0);
  });

  test('ignores case', () => {
    const match = findTypeaheadMatch({names, from: 0, query: 'W'});

    expect(match).toBe(3);
  });

  test('stays on the current name when a longer query still matches it', () => {
    const match = findTypeaheadMatch({names, from: 3, query: 'wo'});

    expect(match).toBe(3);
  });

  test('moves on when a longer query stops matching the current name', () => {
    const match = findTypeaheadMatch({names, from: 3, query: 'worke'});

    expect(match).toBe(4);
  });

  test('cycles through matches when one character repeats', () => {
    const match = findTypeaheadMatch({names, from: 3, query: 'ww'});

    expect(match).toBe(4);
  });

  test('cycles when one character repeats in a different case', () => {
    const match = findTypeaheadMatch({names, from: 3, query: 'wW'});

    expect(match).toBe(4);
  });

  test('returns the current name when it is the only match', () => {
    const match = findTypeaheadMatch({names, from: 2, query: 'i'});

    expect(match).toBe(2);
  });

  test('returns undefined when nothing matches', () => {
    const match = findTypeaheadMatch({names, from: 0, query: 'z'});

    expect(match).toBeUndefined();
  });

  test('returns undefined for an empty tree', () => {
    const match = findTypeaheadMatch({names: [], from: 0, query: 'a'});

    expect(match).toBeUndefined();
  });
});
