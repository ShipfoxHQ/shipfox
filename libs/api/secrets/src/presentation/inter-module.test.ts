import crypto from 'node:crypto';
import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {setVariables} from '#core/index.js';
import {createSecretsInterModulePresentation} from './inter-module.js';

describe('Secrets inter-module presentation', () => {
  test('persists and reads scoped secret and variable values through the transport', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(secretsInterModuleContract);
    transport.register(createSecretsInterModulePresentation());
    transport.seal();

    await client.setSecrets({
      workspaceId,
      projectId,
      values: {TOKEN: 'project-value'},
    });
    const secret = await client.getSecret({workspaceId, projectId, key: 'TOKEN'});
    await setVariables({workspaceId, projectId, values: {REGION: 'eu-west-3'}});
    const namespace = await client.getSecretsByNamespace({workspaceId, projectId});
    const variables = await client.getVariablesByNamespace({workspaceId, projectId});
    const deleted = await client.deleteSecrets({workspaceId, projectId, keys: ['TOKEN']});

    expect(secret).toEqual({value: 'project-value'});
    expect(namespace).toEqual({values: {TOKEN: 'project-value'}});
    expect(variables).toEqual({values: {REGION: 'eu-west-3'}});
    expect(deleted).toEqual({deleted: 1});
  });
});
