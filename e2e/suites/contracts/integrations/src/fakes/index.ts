import {claapContractFake} from './claap.js';
import {clickupContractFake} from './clickup.js';
import {discordContractFake} from './discord.js';
import {githubContractFake} from './github.js';
import {jamContractFake} from './jam.js';
import {jiraContractFake} from './jira.js';
import {linearContractFake} from './linear.js';
import {notionContractFake} from './notion.js';
import {posthogContractFake} from './posthog.js';
import type {ContractFakeAdapter} from './shared.js';
import {slackContractFake} from './slack.js';

/**
 * The adapter of each provider the suite can run in fake mode. A provider joins when its fake
 * parity unit adds its adapter, and its cases gain `fake` in `modes` in the same change.
 */
export const CONTRACT_FAKE_ADAPTERS: Readonly<Record<string, ContractFakeAdapter>> = {
  claap: claapContractFake as ContractFakeAdapter,
  clickup: clickupContractFake as ContractFakeAdapter,
  discord: discordContractFake as ContractFakeAdapter,
  github: githubContractFake as ContractFakeAdapter,
  jam: jamContractFake as ContractFakeAdapter,
  jira: jiraContractFake as ContractFakeAdapter,
  linear: linearContractFake as ContractFakeAdapter,
  notion: notionContractFake as ContractFakeAdapter,
  posthog: posthogContractFake as ContractFakeAdapter,
  slack: slackContractFake as ContractFakeAdapter,
};
