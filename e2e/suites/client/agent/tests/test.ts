import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type AgentScreenFixtures, agentScreens} from '@shipfox/e2e-screens-agent';
import {type AgentFixtures, agentHelper} from '@shipfox/e2e-setup-agent';

export const test = base.extend<WorkspaceFixtures & AgentFixtures & AgentScreenFixtures>({
  ...workspaceFixtures,
  ...agentHelper,
  ...agentScreens,
});
export {expect};
