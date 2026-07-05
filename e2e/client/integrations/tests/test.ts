import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type GiteaFixtures, giteaHelper} from '@shipfox/e2e-helper-integrations-gitea';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';

export const test = base.extend<WorkspaceFixtures & GiteaFixtures>({
  ...workspaceFixtures,
  ...giteaHelper,
});
export {expect};
