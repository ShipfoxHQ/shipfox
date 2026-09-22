import crypto from 'node:crypto';
import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {setVariables} from '#core/index.js';
import {createSecretsInterModulePresentation} from './inter-module.js';

describe('Secrets inter-module presentation', () => {
  test('lists secret and variable names without values through the transport', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(secretsInterModuleContract);
    transport.register(createSecretsInterModulePresentation());
    transport.seal();

    await client.setSecrets({workspaceId, values: {WORKSPACE_TOKEN: 'workspace-value'}});
    await client.setSecrets({
      workspaceId,
      projectId,
      values: {PROJECT_TOKEN: 'project-value'},
    });
    await setVariables({
      workspaceId,
      values: {WORKSPACE_REGION: 'workspace-region'},
    });
    await setVariables({
      workspaceId,
      projectId,
      values: {PROJECT_REGION: 'project-region'},
    });

    const workspaceSecrets = await client.listSecretNames({workspaceId});
    const projectSecrets = await client.listSecretNames({workspaceId, projectId});
    const workspaceVariables = await client.listVariableNames({workspaceId});
    const projectVariables = await client.listVariableNames({workspaceId, projectId});

    expect(workspaceSecrets).toEqual({names: ['WORKSPACE_TOKEN']});
    expect(projectSecrets).toEqual({names: ['PROJECT_TOKEN']});
    expect(workspaceVariables).toEqual({names: ['WORKSPACE_REGION']});
    expect(projectVariables).toEqual({names: ['PROJECT_REGION']});
    expect(workspaceSecrets).not.toHaveProperty('value');
    expect(workspaceVariables).not.toHaveProperty('value');
  });

  test('persists and reads scoped secret and variable values through the transport', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(secretsInterModuleContract);
    transport.register(createSecretsInterModulePresentation());
    transport.seal();

    await client.setSecrets({workspaceId, values: {TOKEN: 'workspace-value'}});
    await client.setSecrets({
      workspaceId,
      projectId,
      values: {TOKEN: 'project-value'},
    });
    const secret = await client.getSecret({workspaceId, projectId, key: 'TOKEN'});
    const exactWorkspaceSecret = await client.getSecret({
      workspaceId,
      key: 'TOKEN',
      exactScope: true,
    });
    const missingProjectSecret = await client.getSecret({
      workspaceId,
      projectId: crypto.randomUUID(),
      key: 'TOKEN',
      exactScope: true,
    });
    await setVariables({workspaceId, projectId, values: {REGION: 'eu-west-3'}});
    const namespace = await client.getSecretsByNamespace({workspaceId, projectId});
    const variables = await client.getVariablesByNamespace({workspaceId, projectId});
    const deleted = await client.deleteSecrets({workspaceId, projectId, keys: ['TOKEN']});

    expect(secret).toEqual({value: 'project-value', projectId});
    expect(exactWorkspaceSecret).toEqual({value: 'workspace-value', projectId: null});
    expect(missingProjectSecret).toEqual({value: null, projectId: null});
    expect(namespace).toEqual({values: {TOKEN: 'project-value'}});
    expect(variables).toEqual({values: {REGION: 'eu-west-3'}});
    expect(deleted).toEqual({deleted: 1});
  });
});
