import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type GiteaFixtures, giteaHelper} from '@shipfox/e2e-helper-integrations-gitea';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type WorkspacesScreenFixtures, workspacesScreens} from '@shipfox/e2e-screens-workspaces';

export const test = base.extend<WorkspaceFixtures & GiteaFixtures & WorkspacesScreenFixtures>({
  ...workspaceFixtures,
  ...giteaHelper,
  ...workspacesScreens,
});
export {expect};
