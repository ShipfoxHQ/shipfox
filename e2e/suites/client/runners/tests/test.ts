import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type RunnerScreenFixtures, runnerScreens} from '@shipfox/e2e-screens-runners';

export const test = base.extend<WorkspaceFixtures & RunnerScreenFixtures>({
  ...workspaceFixtures,
  ...runnerScreens,
});
export {expect};
