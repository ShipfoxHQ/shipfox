import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {expect, test} from './test.js';

test('settings narrows a new GitHub connection to the repositories of its projects', async ({
  connectionDetails,
  createReadyWorkspace,
}) => {
  const {workspaceId, workspaceSlug} = await createReadyWorkspace({
    name: 'Repository Access Settings Workspace',
  });
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const connection = await createGithubConnection({
    workspaceId,
    installationId: Number.parseInt(uniqueId.slice(0, 7), 16) + 1,
    accountLogin: `e${uniqueId.slice(0, 5)}`,
    displayName: `GitHub Settings ${uniqueId}`,
    installerUserId: crypto.randomUUID(),
  });
  await createProject({
    workspaceId,
    name: `GitHub Settings Project ${uniqueId}`,
    sourceConnectionId: connection.id,
    sourceExternalRepositoryId: 'github:42',
    sourceRepositoryOwner: 'shipfox',
    sourceRepositoryName: 'e2e',
    sourceDefaultBranch: 'main',
  });

  await connectionDetails.goto(workspaceSlug, connection.slug);

  // A new connection reaches every repository the GitHub App can see.
  await expect(connectionDetails.heading()).toBeVisible();
  await expect(connectionDetails.allMode()).toBeChecked();
  await expect(connectionDetails.projectsRepositoriesHeading()).toHaveCount(0);

  // The project-backed list comes from local project state; no repository grant mutation is
  // needed to populate it.
  await connectionDetails.selectedMode().check();
  await connectionDetails.saveMode();
  await expect(connectionDetails.selectedMode()).toBeChecked();
  await expect(connectionDetails.projectsRepositoriesHeading()).toBeVisible();
  await expect(connectionDetails.repository('shipfox/e2e')).toBeVisible();
  await expect(connectionDetails.providerNotice()).toBeVisible();
  await connectionDetails.goto(workspaceSlug, connection.slug);
  await expect(connectionDetails.selectedMode()).toBeChecked();
  await expect(connectionDetails.repository('shipfox/e2e')).toBeVisible();
});
