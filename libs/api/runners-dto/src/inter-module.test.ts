import {runnersInterModuleContract} from './inter-module.js';

describe('runnersInterModuleContract', () => {
  test('parses an active lease', () => {
    const result = runnersInterModuleContract.methods.getLeaseState.output.parse({
      active: true,
    });

    expect(result).toEqual({active: true});
  });

  test('exposes bounded JSON capability results', () => {
    const capabilities = {
      harnesses: {pi: {tools: ['read']}},
    };
    const result =
      runnersInterModuleContract.methods.getEffectiveRunnerToolCapabilities.output.parse({
        capabilities,
      });

    expect(result).toEqual({capabilities});
  });
});
