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

  test('accepts exact-scope reads and returns the matched project scope', () => {
    const input = secretsInterModuleContract.methods.getSecret.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      key: 'API_KEY',
      exactScope: true,
    });
    const output = secretsInterModuleContract.methods.getSecret.output.parse({
      value: 'secret-value',
      projectId: '00000000-0000-4000-8000-000000000002',
    });

    expect(input.exactScope).toBe(true);
    expect(output.projectId).toBe('00000000-0000-4000-8000-000000000002');
  });

  test('defines names-only reads without value fields', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const projectId = '00000000-0000-4000-8000-000000000002';

    expect(
      secretsInterModuleContract.methods.listSecretNames.input.parse({workspaceId, projectId}),
    ).toEqual({workspaceId, projectId});
    expect(secretsInterModuleContract.methods.listVariableNames.input.parse({workspaceId})).toEqual(
      {workspaceId},
    );

    const secretNames = secretsInterModuleContract.methods.listSecretNames.output.parse({
      names: ['API_KEY'],
      value: 'must-not-cross-the-boundary',
    });
    const variableNames = secretsInterModuleContract.methods.listVariableNames.output.parse({
      names: ['REGION'],
      values: {REGION: 'must-not-cross-the-boundary'},
    });

    expect(secretNames).toEqual({names: ['API_KEY']});
    expect(variableNames).toEqual({names: ['REGION']});
    expect(secretNames).not.toHaveProperty('value');
    expect(variableNames).not.toHaveProperty('values');
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
