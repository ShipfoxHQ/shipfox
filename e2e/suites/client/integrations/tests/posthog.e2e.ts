import {createApiClient} from '@shipfox/e2e-core';
import {createPosthogConnection} from '@shipfox/e2e-setup-integrations';
import {expect, test} from './test.js';

test.describe('PostHog connection', () => {
  test('connects one project, picks a project, and offers replacement for an existing project', async ({
    integrationsCatalogue,
    createReadyWorkspace,
  }) => {
    const {workspaceSlug} = await createReadyWorkspace({name: 'PostHog connect E2E'});

    await integrationsCatalogue.goto(workspaceSlug);
    await integrationsCatalogue.addButton('PostHog').click();
    await integrationsCatalogue.posthogKeyField().fill('phx-single-project');
    await integrationsCatalogue.posthogConnectButton().click();
    await expect(integrationsCatalogue.installedProviderName('E2E Single project')).toBeVisible();

    await integrationsCatalogue.addButton('PostHog').click();
    await integrationsCatalogue.posthogKeyField().fill('phx-multi-project');
    await integrationsCatalogue.posthogConnectButton().click();
    await expect(integrationsCatalogue.posthogProject('E2E Analytics')).toBeVisible();
    await integrationsCatalogue.posthogProject('E2E Analytics').click();
    await expect(integrationsCatalogue.installedProviderName('E2E Analytics')).toBeVisible();

    await integrationsCatalogue.addButton('PostHog').click();
    await integrationsCatalogue.posthogKeyField().fill('phx-single-project');
    await integrationsCatalogue.posthogConnectButton().click();
    await expect(integrationsCatalogue.posthogAlreadyConnected()).toBeVisible();
    await integrationsCatalogue.posthogReplaceButton().click();
    await expect(integrationsCatalogue.posthogReplacementKeyField()).toBeVisible();
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
      apiKey: 'phx-revoked-single',
      projectId: 'e2e-single-project',
      projectName: 'E2E Revoked project',
      organizationId: 'e2e-organization',
    });
    const api = createApiClient({token: ready.sessionToken});
    await api.request('patch', `/integration-connections/${connection.id}`, {
      json: {lifecycle_status: 'error'},
    });

    await connectionDetails.goto(ready.workspaceSlug, connection.slug);
    await expect(connectionDetails.posthogError()).toBeVisible();
    await connectionDetails.posthogReplaceButton().click();
    await connectionDetails.posthogKeyField().fill('phx-single-replacement');
    await connectionDetails
      .posthogReplaceDialog()
      .getByRole('button', {name: 'Replace API key'})
      .click();

    await expect(connectionDetails.posthogError()).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'PostHog connection'})).toBeVisible();
  });
});
