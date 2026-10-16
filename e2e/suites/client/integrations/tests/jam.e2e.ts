import {createJamConnection} from '@shipfox/e2e-setup-integrations';
import {expect, test} from './test.js';

const INVALID_TOKEN_RE = /Jam rejected this token/u;
const CLI_ONLY_RE = /This token has no MCP access/u;
// The Jam workspace and user that the Jam mock's introspection returns for a live token.
const MOCK_TEAM_ID = 'bf9da890-a8ce-4cf6-8627-1e352ddba3c8';
const MOCK_USER_NAME = 'Jam Sandbox Owner';

test.describe('Jam connection', () => {
  test('connects a Jam workspace and offers replacement when it is already connected', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({name: 'Jam connect E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('Jam').click();
    await integrationsCatalogue.jamTokenField().fill('jam_pat_client_connect');
    await integrationsCatalogue.connectButton().click();
    await expect(integrationsCatalogue.installedProviderName('Jam')).toBeVisible();

    await integrationsCatalogue.addButton('Jam').click();
    await integrationsCatalogue.jamTokenField().fill('jam_pat_client_second');
    await integrationsCatalogue.connectButton().click();
    await expect(integrationsCatalogue.jamAlreadyConnected()).toBeVisible();
    await integrationsCatalogue.jamReplaceButton().click();
    await expect(integrationsCatalogue.jamReplacementTokenField()).toBeVisible();
  });

  test('explains a rejected token on the token field', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({name: 'Jam invalid token E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('Jam').click();
    await integrationsCatalogue.jamTokenField().fill('jam_pat_client_revoked');
    await integrationsCatalogue.connectButton().click();

    await expect(integrationsCatalogue.jamTokenField()).toHaveAttribute('aria-invalid', 'true');
    await expect(integrationsCatalogue.jamTokenField()).toHaveAccessibleDescription(
      INVALID_TOKEN_RE,
    );
  });

  test('rejects a token with CLI access only', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({name: 'Jam CLI-only token E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('Jam').click();
    await integrationsCatalogue.jamTokenField().fill('jam_pat_client_cli-only');
    await integrationsCatalogue.connectButton().click();

    await expect(integrationsCatalogue.jamTokenField()).toHaveAttribute('aria-invalid', 'true');
    await expect(integrationsCatalogue.jamTokenField()).toHaveAccessibleDescription(CLI_ONLY_RE);
  });

  test('replaces the token of an error connection and shows the new Jam user', async ({
    page,
    connectionDetails,
    createReadyWorkspace,
  }) => {
    const ready = await createReadyWorkspace({name: 'Jam replacement E2E'});
    const connection = await createJamConnection({
      workspaceId: ready.workspaceId,
      token: 'jam_pat_client_revoked_old',
      teamId: MOCK_TEAM_ID,
      userId: 'e2e-former-user',
      userName: 'Former Jam user',
      lifecycleStatus: 'error',
    });

    await connectionDetails.goto(ready.workspaceSlug, connection.slug);
    await expect(connectionDetails.jamError()).toBeVisible();
    await expect(connectionDetails.jamUser('Former Jam user')).toBeVisible();
    await connectionDetails.jamReplaceButton().click();
    await connectionDetails.jamTokenField().fill('jam_pat_client_replacement');
    await connectionDetails.jamReplaceDialog().getByRole('button', {name: 'Replace token'}).click();

    await expect(connectionDetails.jamError()).toHaveCount(0);
    await expect(connectionDetails.jamUser(MOCK_USER_NAME)).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Jam connection'})).toBeVisible();
  });
});
