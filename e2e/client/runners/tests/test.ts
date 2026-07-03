import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type AuthFixtures, authHelper} from '@shipfox/e2e-helper-auth';
import {type ProjectsFixtures, projectsHelper} from '@shipfox/e2e-helper-projects';
import {type WorkspacesFixtures, workspacesHelper} from '@shipfox/e2e-helper-workspaces';

export const test = base.extend<AuthFixtures & ProjectsFixtures & WorkspacesFixtures>({
  ...authHelper,
  ...projectsHelper,
  ...workspacesHelper,
});
export {expect};
