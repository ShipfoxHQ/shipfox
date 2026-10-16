import {seedClaapMock} from '@shipfox/e2e-driver-claap';
import {createClaapConnection} from '@shipfox/e2e-setup-integrations';
import {expect, test} from './test.js';

const INVALID_KEY_RE = /Claap did not accept this key/u;

test.describe('Claap connection', () => {
  test('connects a Claap workspace and offers replacement when it is already connected', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const uniqueId = shortId();
    const apiKey = `cla_client_${uniqueId}`;
    await seedClaapWorkspace({apiKey, claapWorkspaceId: `client${uniqueId}`, uniqueId});
    const {workspaceSlug} = await createReadyWorkspace({name: 'Claap connect E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('Claap').click();
    await integrationsCatalogue.claapKeyField().fill(apiKey);
    await integrationsCatalogue.claapConnectButton().click();
    await expect(
      integrationsCatalogue.installedProviderName(`Claap Client ${uniqueId}`),
    ).toBeVisible();

    await integrationsCatalogue.addButton('Claap').click();
    await integrationsCatalogue.claapKeyField().fill(apiKey);
    await integrationsCatalogue.claapConnectButton().click();
    await expect(integrationsCatalogue.claapAlreadyConnected()).toBeVisible();
    await integrationsCatalogue.claapReplaceButton().click();
    await expect(integrationsCatalogue.claapReplacementKeyField()).toBeVisible();
  });

  test('explains a rejected key on the key field', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({name: 'Claap invalid key E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('Claap').click();
    await integrationsCatalogue.claapKeyField().fill(`cla_unknown_${shortId()}`);
    await integrationsCatalogue.claapConnectButton().click();

    await expect(integrationsCatalogue.claapKeyField()).toHaveAttribute('aria-invalid', 'true');
    await expect(integrationsCatalogue.claapKeyField()).toHaveAccessibleDescription(INVALID_KEY_RE);
  });

  test('replaces the key for an error connection using the signed-in session', async ({
    page,
    connectionDetails,
    createReadyWorkspace,
  }) => {
    const uniqueId = shortId();
    const claapWorkspaceId = `client${uniqueId}`;
    const replacementKey = `cla_replacement_${uniqueId}`;
    await seedClaapWorkspace({apiKey: replacementKey, claapWorkspaceId, uniqueId});
    const ready = await createReadyWorkspace({name: 'Claap replacement E2E'});
    const connection = await createClaapConnection({
      workspaceId: ready.workspaceId,
      apiKey: `cla_revoked_${uniqueId}`,
      claapWorkspaceId,
      claapWorkspaceName: `Client ${uniqueId}`,
      lifecycleStatus: 'error',
    });

    await connectionDetails.goto(ready.workspaceSlug, connection.slug);
    await expect(connectionDetails.claapError()).toBeVisible();
    await connectionDetails.claapReplaceButton().click();
    await connectionDetails.claapKeyField().fill(replacementKey);
    await connectionDetails
      .claapReplaceDialog()
      .getByRole('button', {name: 'Replace API key'})
      .click();

    await expect(connectionDetails.claapError()).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'Claap connection'})).toBeVisible();
  });
});

async function seedClaapWorkspace(params: {
  apiKey: string;
  claapWorkspaceId: string;
  uniqueId: string;
}): Promise<void> {
  await seedClaapMock({
    apiKey: params.apiKey,
    seed: {
      workspace: {workspaceId: params.claapWorkspaceId, name: `Client ${params.uniqueId}`},
      recordings: [],
    },
  });
}

// The fake keeps seeds by key for the whole run, so each spec seeds keys of its own.
function shortId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10);
}
