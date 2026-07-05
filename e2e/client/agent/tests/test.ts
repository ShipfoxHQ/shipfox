import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type AgentFixtures, agentHelper} from '@shipfox/e2e-helper-agent';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';

export const test = base.extend<WorkspaceFixtures & AgentFixtures>({
  ...workspaceFixtures,
  ...agentHelper,
});
export {expect};
