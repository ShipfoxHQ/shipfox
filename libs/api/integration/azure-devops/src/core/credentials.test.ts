import {azureDevOpsConnection, memorySecrets} from '#test/index.js';
import {createSecretsConnectionCredentials} from './credentials.js';

describe('createSecretsConnectionCredentials', () => {
  it('reads the credential stored under the connection namespace of its workspace', async () => {
    const connection = azureDevOpsConnection();
    const secrets = memorySecrets();
    await secrets.setSecrets({
      workspaceId: connection.workspaceId,
      namespace: connection.id,
      values: {credential_kind: 'pat', credential_token: 'stored-pat'},
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
      values: {credential_kind: 'pat', credential_token: 'other'},
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
      values: {credential_kind: 'password', credential_token: 'x'},
    });

    await expect(
      createSecretsConnectionCredentials(secrets).resolve(connection),
    ).rejects.toMatchObject({reason: 'credentials-unavailable'});
  });
});
