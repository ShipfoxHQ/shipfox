import {readStepOutputs} from './read-step-outputs.js';

describe('readStepOutputs', () => {
  it('keeps type, schema, and required from the step config', () => {
    const outputs = {
      sha: {type: 'string'},
      count: {type: 'number', required: true},
      summary: {type: 'json', schema: {type: 'string'}, required: false},
    };

    const result = readStepOutputs({run: 'echo hi', outputs});

    expect(result).toEqual(outputs);
  });

  it('leaves required absent when the config omits it', () => {
    const result = readStepOutputs({outputs: {sha: {type: 'string'}}});

    expect(result?.sha).not.toHaveProperty('required');
  });

  it.each([
    ['a non-boolean required', {sha: {type: 'string', required: 'false'}}],
    ['an unknown type', {sha: {type: 'bytes'}}],
    ['a non-object declaration', {sha: 'string'}],
  ])('returns undefined for %s', (_label, outputs) => {
    const result = readStepOutputs({outputs});

    expect(result).toBeUndefined();
  });
});
