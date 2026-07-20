import {secretsInterModuleContract} from './inter-module.js';

describe('secretsInterModuleContract', () => {
  test('accepts JSON-safe secret operations', () => {
    const input = secretsInterModuleContract.methods.setSecrets.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      namespace: 'system/agent/model-provider/openai',
      values: {API_KEY: 'secret-value'},
    });

    expect(input.values).toEqual({API_KEY: 'secret-value'});
  });

  test('defines stable known errors without secret values', () => {
    expect(
      secretsInterModuleContract.methods.getSecret.errors['secret-decryption-failed'].parse({}),
    ).toEqual({});
    expect(
      secretsInterModuleContract.methods.setSecrets.errors['value-too-large'].parse({
        maxBytes: 65_536,
      }),
    ).toEqual({maxBytes: 65_536});
    expect(
      secretsInterModuleContract.methods.setSecrets.errors['workspace-secret-cap-exceeded'].parse({
        cap: 10_000,
      }),
    ).toEqual({cap: 10_000});
  });
});
