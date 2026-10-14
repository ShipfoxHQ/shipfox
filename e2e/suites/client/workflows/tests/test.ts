import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type WorkflowsScreenFixtures, workflowsScreens} from '@shipfox/e2e-screens-workflows';

export const test = base.extend<WorkspaceFixtures & WorkflowsScreenFixtures>({
  ...workspaceFixtures,
  ...workflowsScreens,
});
export {expect};
