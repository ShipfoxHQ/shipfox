import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type AuthWorkspaceFixtures, authWorkspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type AuthScreenFixtures, authScreens} from '@shipfox/e2e-screens-auth';

export const test = base.extend<AuthWorkspaceFixtures & AuthScreenFixtures>({
  ...authWorkspaceFixtures,
  ...authScreens,
});
export {expect};
