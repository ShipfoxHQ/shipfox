import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type AuthFixtures, authHelper} from '@shipfox/e2e-helper-auth';
import {type WorkspacesFixtures, workspacesHelper} from '@shipfox/e2e-helper-workspaces';

export const test = base.extend<AuthFixtures & WorkspacesFixtures>({
  ...authHelper,
  ...workspacesHelper,
});
export {expect};
