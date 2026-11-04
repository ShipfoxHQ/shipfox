import type {ListRepositoriesResponseDto} from '@shipfox/api-integration-core-dto';
import {createApiClient} from '@shipfox/e2e-core';
import {expect, test} from './test.js';

interface CreatedProject {
  id: string;
  slug: string;
}

test('an admin narrows a project to its config repository and one more', async ({
  createReadyWorkspace,
  gitea,
  projectAccess,
}) => {
  const {workspaceId, workspaceSlug, sessionToken} = await createReadyWorkspace({
    name: 'Project Access Workspace',
  });
  const org = await gitea.createConnectedOrg({workspaceId, sessionToken});
  await gitea.createRepo({org: org.org, name: 'app'});
  await gitea.createRepo({org: org.org, name: 'other'});
  const client = createApiClient({token: sessionToken});
  const {repositories} = await client.requestJson<ListRepositoriesResponseDto>(
    'get',
    `/integration-connections/${org.connection.id}/repositories`,
  );
  const app = repositories.find((repository) => repository.name === 'app');
  if (!app) throw new Error('Gitea did not list the app repository');
  const project = await client.requestJson<CreatedProject>('post', '/projects', {
    json: {
      workspace_id: workspaceId,
      name: 'Access App',
      slug: 'access-app',
      source: {
        connection_id: org.connection.id,
        external_repository_id: app.external_repository_id,
      },
    },
  });
  const connectionName = `Gitea, ${org.connection.display_name}`;

  await projectAccess.goto(workspaceSlug, project.slug);
  await expect(projectAccess.heading()).toBeVisible();
  await projectAccess.onlyTheseConnections().check();
  // The config source connection is part of the access, so it is checked and locked.
  await expect(projectAccess.connection(connectionName)).toBeChecked();
  await expect(projectAccess.connection(connectionName)).toBeDisabled();
  await projectAccess.limitToSelected(connectionName);
  await expect(projectAccess.selectedRepositories(connectionName)).toContainText(app.full_name);
  await projectAccess.save();

  await projectAccess.goto(workspaceSlug, project.slug);
  await expect(projectAccess.onlyTheseConnections()).toBeChecked();
  await expect(projectAccess.resourceScope(connectionName)).toHaveText('Selected (1)');

  await projectAccess.selectRepository(`${org.org}/other`);
  await projectAccess.save();

  await projectAccess.goto(workspaceSlug, project.slug);
  await expect(projectAccess.resourceScope(connectionName)).toHaveText('Selected (2)');
  await expect(projectAccess.selectedRepositories(connectionName)).toContainText(
    `${org.org}/other`,
  );
});
