import {isBareContextReference} from './bare-reference.js';

describe('isBareContextReference', () => {
  it.each([
    'runner.os',
    'runner.labels.os',
    'steps.build.outputs.sha',
  ])('accepts dotted member access: %s', (source) => {
    const result = isBareContextReference(source);

    expect(result).toBe(true);
  });

  it.each([
    'runner',
    'runner.?os',
    'runner.os + runner.arch',
    'runner.labels["os"]',
    'runner.os()',
    'runner.os ? runner.arch : "x"',
    '[runner.os]',
  ])('rejects non-bare reference shape: %s', (source) => {
    const result = isBareContextReference(source);

    expect(result).toBe(false);
  });
});
