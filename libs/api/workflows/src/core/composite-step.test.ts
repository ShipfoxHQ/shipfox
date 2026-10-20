import {
  compositeAncestorsOf,
  type StepPathNode,
  stepPath,
  stepPathLabel,
} from './composite-step.js';

function node(overrides: Partial<StepPathNode> & {id: string}): StepPathNode {
  return {parentStepId: null, key: null, name: 'Step', position: 1, ...overrides};
}

describe('step path', () => {
  const setup = node({id: 'setup', key: 'setup'});
  const nested = node({id: 'nested', parentStepId: 'setup', key: 'nested'});
  const lint = node({id: 'lint', parentStepId: 'nested', key: 'lint', name: 'Lint files'});

  test('names an inner step by key from its outermost composite down', () => {
    const path = stepPath(lint, compositeAncestorsOf(lint, [lint, nested, setup]));

    expect(path).toEqual(['setup', 'nested', 'lint']);
    expect(stepPathLabel(path)).toBe('setup › nested › lint');
  });

  test('falls back to the trimmed name, then to the position, like the run page', () => {
    expect(stepPath(node({id: 'a', key: ' ', name: ' Build '}), [])).toEqual(['Build']);
    expect(stepPath(node({id: 'b', name: ' ', position: 3}), [])).toEqual(['Step 4']);
  });

  test('stops at a composite it has already seen', () => {
    const first = node({id: 'first', parentStepId: 'second', key: 'first'});
    const second = node({id: 'second', parentStepId: 'first', key: 'second'});
    const inner = node({id: 'inner', parentStepId: 'first', key: 'inner'});

    expect(compositeAncestorsOf(inner, [first, second, inner])).toEqual([second, first]);
  });
});
