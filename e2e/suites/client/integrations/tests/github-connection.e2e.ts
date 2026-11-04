import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {expect, test} from './test.js';

test('settings points a GitHub connection at its installation on GitHub', async ({
  connectionDetails,
  createReadyWorkspace,
}) => {
  const {workspaceId, workspaceSlug} = await createReadyWorkspace({
    name: 'GitHub Connection Settings Workspace',
  });
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const connection = await createGithubConnection({
    workspaceId,
    installationId: Number.parseInt(uniqueId.slice(0, 7), 16) + 1,
    accountLogin: `e${uniqueId.slice(0, 5)}`,
    displayName: `GitHub Settings ${uniqueId}`,
    installerUserId: crypto.randomUUID(),
  });

  await connectionDetails.goto(workspaceSlug, connection.slug);

  await expect(connectionDetails.heading()).toBeVisible();
  await expect(connectionDetails.providerNotice()).toBeVisible();
});
