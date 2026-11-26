import {azureDevOpsConnection, memorySecrets} from '#test/index.js';
import {createSecretsConnectionCredentials} from './credentials.js';

describe('createSecretsConnectionCredentials', () => {
  it('reads the credential stored under the connection namespace of its workspace', async () => {
    const connection = azureDevOpsConnection();
    const secrets = memorySecrets();
    await secrets.setSecrets({
      workspaceId: connection.workspaceId,
      namespace: connection.id,
      values: {CREDENTIAL_KIND: 'pat', CREDENTIAL_TOKEN: 'stored-pat'},
    });

    const credential = await createSecretsConnectionCredentials(secrets).resolve(connection);

    expect(credential).toEqual({kind: 'pat', token: 'stored-pat'});
  });

  it('does not read another workspace secret under the same connection id', async () => {
    const connection = azureDevOpsConnection();
    const secrets = memorySecrets();
    await secrets.setSecrets({
      workspaceId: crypto.randomUUID(),
      namespace: connection.id,
      values: {CREDENTIAL_KIND: 'pat', CREDENTIAL_TOKEN: 'other'},
    });

    await expect(
      createSecretsConnectionCredentials(secrets).resolve(connection),
    ).rejects.toMatchObject({reason: 'credentials-unavailable'});
  });

  it('reports credentials-unavailable when the stored kind is unknown', async () => {
    const connection = azureDevOpsConnection();
    const secrets = memorySecrets();
    await secrets.setSecrets({
      workspaceId: connection.workspaceId,
      namespace: connection.id,
      values: {CREDENTIAL_KIND: 'password', CREDENTIAL_TOKEN: 'x'},
    });

    await expect(
      createSecretsConnectionCredentials(secrets).resolve(connection),
    ).rejects.toMatchObject({reason: 'credentials-unavailable'});
  });
});
