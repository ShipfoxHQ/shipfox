import {createPosthogConnection} from '@shipfox/e2e-setup-integrations';
import {expect, test} from './test.js';

const MISSING_SCOPES_RE = /This key is missing required read scopes/u;

test.describe('PostHog connection', () => {
  test('connects a scoped project, picks a project, and offers replacement for an existing project', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({name: 'PostHog connect E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('PostHog').click();
    await integrationsCatalogue.posthogKeyField().fill('phx_scoped_single_project');
    await integrationsCatalogue.posthogConnectButton().click();
    await expect(integrationsCatalogue.installedProviderName('E2E Single project')).toBeVisible();

    await integrationsCatalogue.addButton('PostHog').click();
    await integrationsCatalogue.posthogKeyField().fill('phx_multi_project');
    await integrationsCatalogue.posthogConnectButton().click();
    await expect(integrationsCatalogue.posthogProject('E2E Analytics')).toBeVisible();
    await integrationsCatalogue.posthogProject('E2E Analytics').click();
    await expect(integrationsCatalogue.installedProviderName('E2E Analytics')).toBeVisible();

    await integrationsCatalogue.addButton('PostHog').click();
    await integrationsCatalogue.posthogKeyField().fill('phx_scoped_single_project');
    await integrationsCatalogue.posthogConnectButton().click();
    await expect(integrationsCatalogue.posthogAlreadyConnected()).toBeVisible();
    await integrationsCatalogue.posthogReplaceButton().click();
    await expect(integrationsCatalogue.posthogReplacementKeyField()).toBeVisible();
  });

  test('explains missing read scopes on the key field', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({name: 'PostHog permissions E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('PostHog').click();
    await integrationsCatalogue.posthogKeyField().fill('phx_scoped_single_missing-scope');
    await integrationsCatalogue.posthogConnectButton().click();

    await expect(integrationsCatalogue.posthogKeyField()).toHaveAttribute('aria-invalid', 'true');
    await expect(integrationsCatalogue.posthogKeyField()).toHaveAccessibleDescription(
      MISSING_SCOPES_RE,
    );
  });

  test('replaces the key for an error connection using the signed-in session', async ({
    page,
    connectionDetails,
    createReadyWorkspace,
  }) => {
    const ready = await createReadyWorkspace({name: 'PostHog replacement E2E'});
    const connection = await createPosthogConnection({
      workspaceId: ready.workspaceId,
      region: 'us',
      apiKey: 'phx_revoked_single',
      projectId: '101',
      projectName: 'E2E Revoked project',
      organizationId: 'e2e-organization',
      lifecycleStatus: 'error',
    });

    await connectionDetails.goto(ready.workspaceSlug, connection.slug);
    await expect(connectionDetails.posthogError()).toBeVisible();
    await connectionDetails.posthogReplaceButton().click();
    await connectionDetails.posthogKeyField().fill('phx_scoped_single_replacement');
    await connectionDetails
      .posthogReplaceDialog()
      .getByRole('button', {name: 'Replace API key'})
      .click();

    await expect(connectionDetails.posthogError()).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'PostHog connection'})).toBeVisible();
  });
});
