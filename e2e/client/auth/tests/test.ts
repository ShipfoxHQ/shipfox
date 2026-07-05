import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type AuthWorkspaceFixtures, authWorkspaceFixtures} from '@shipfox/e2e-kit/fixtures';

export const test = base.extend<AuthWorkspaceFixtures>(authWorkspaceFixtures);
export {expect};
