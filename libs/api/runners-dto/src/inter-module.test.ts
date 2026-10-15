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

  test('returns a runner platform or null', () => {
    const output = runnersInterModuleContract.methods.getRunnerSessionPlatform.output;

    const platform = output.parse({os: 'linux', arch: 'arm64'});
    const missing = output.parse(null);

    expect(platform).toEqual({os: 'linux', arch: 'arm64'});
    expect(missing).toBeNull();
  });
});
