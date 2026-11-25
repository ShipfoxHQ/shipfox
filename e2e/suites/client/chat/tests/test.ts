import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {type ChatScreenFixtures, chatScreens} from '@shipfox/e2e-screens-chat';
import {type AgentFixtures, agentHelper} from '@shipfox/e2e-setup-agent';

export const test = base.extend<WorkspaceFixtures & AgentFixtures & ChatScreenFixtures>({
  ...workspaceFixtures,
  ...agentHelper,
  ...chatScreens,
});
export {expect};
