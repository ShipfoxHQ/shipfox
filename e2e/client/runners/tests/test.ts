import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';

export const test = base.extend<WorkspaceFixtures>(workspaceFixtures);
export {expect};
