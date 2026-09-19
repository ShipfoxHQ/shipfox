import {runnersInterModuleContract} from './inter-module.js';

describe('runnersInterModuleContract', () => {
  test('carries the claim-time renewable inference snapshot with an active lease', () => {
    const result = runnersInterModuleContract.methods.getLeaseState.output.parse({
      active: true,
      renewableInference: false,
    });

    expect(result).toEqual({active: true, renewableInference: false});
  });

  test('rejects an active lease without its capability snapshot', () => {
    expect(() =>
      runnersInterModuleContract.methods.getLeaseState.output.parse({active: true}),
    ).toThrow();
  });

  test('exposes bounded JSON capability results', () => {
    const capabilities = {
      features: {renewable_git: false, renewable_inference: false},
      harnesses: {pi: {tools: ['read']}},
    };
    const result =
      runnersInterModuleContract.methods.getEffectiveRunnerToolCapabilities.output.parse({
        capabilities,
      });

    expect(result).toEqual({capabilities});
  });
});
