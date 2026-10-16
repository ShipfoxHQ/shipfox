import {
  compositeAncestors,
  compositeAttemptInputs,
  sourceFileLabel,
  sourceLinesLabel,
} from './composite-step.js';

describe('compositeAncestors', () => {
  test('returns the composite steps that hold a step, outermost first', () => {
    const steps = [
      {id: 'outer'},
      {id: 'inner', parentStepId: 'outer'},
      {id: 'leaf', parentStepId: 'inner'},
    ];

    const ancestors = compositeAncestors(steps, 'leaf');

    expect(ancestors.map((step) => step.id)).toEqual(['outer', 'inner']);
  });

  test('stops at a composite step that is not loaded', () => {
    const steps = [
      {id: 'inner', parentStepId: 'outer'},
      {id: 'leaf', parentStepId: 'inner'},
    ];

    const ancestors = compositeAncestors(steps, 'leaf');

    expect(ancestors.map((step) => step.id)).toEqual(['inner']);
  });

  test('returns nothing for a job step', () => {
    const ancestors = compositeAncestors([{id: 'build'}], 'build');

    expect(ancestors).toEqual([]);
  });
});

describe('sourceFileLabel', () => {
  test('names the workflow file when the location has no action file', () => {
    expect(sourceFileLabel(undefined)).toBe('workflow.yaml');
  });

  test('joins the action reference and the manifest path', () => {
    const label = sourceFileLabel({
      kind: 'action',
      uses: './.shipfox/actions/setup/',
      digest: 'sha256:abc',
      path: 'action.yml',
    });

    expect(label).toBe('./.shipfox/actions/setup/action.yml');
  });
});

describe('sourceLinesLabel', () => {
  test('prints one line or a range', () => {
    expect(sourceLinesLabel({startLine: 4, endLine: 4})).toBe('4');
    expect(sourceLinesLabel({startLine: 4, endLine: 9})).toBe('4-9');
  });
});

describe('compositeAttemptInputs', () => {
  test('reads the resolved inputs from a composite attempt config', () => {
    expect(compositeAttemptInputs({inputs: {base_sha: 'abc'}})).toEqual({base_sha: 'abc'});
  });

  test('returns no inputs when the config has none', () => {
    expect(compositeAttemptInputs(null)).toEqual({});
    expect(compositeAttemptInputs({inputs: ['not', 'a', 'map']})).toEqual({});
  });
});
