import {claapProviderModule} from '#providers/claap.js';
import {clickupProviderModule} from '#providers/clickup.js';
import {cronProviderModule} from '#providers/cron.js';
import {discordProviderModule} from '#providers/discord.js';
import {giteaProviderModule} from '#providers/gitea.js';
import {githubProviderModule} from '#providers/github.js';
import {jamProviderModule} from '#providers/jam.js';
import {jiraProviderModule} from '#providers/jira.js';
import {linearProviderModule} from '#providers/linear.js';
import {notionProviderModule} from '#providers/notion.js';
import {posthogProviderModule} from '#providers/posthog.js';
import {sentryProviderModule} from '#providers/sentry.js';
import {shipfoxProviderModule} from '#providers/shipfox.js';
import {slackProviderModule} from '#providers/slack.js';
import {testVcsProviderModule} from '#providers/test-vcs-module.js';
import type {
  IntegrationModuleParts,
  IntegrationProviderModuleLoadOptions,
} from '#providers/types.js';
import {webhookProviderModule} from '#providers/webhook.js';

// Order is significant: databases are migrated in this order, so list a provider
// before any that depend on its tables.
const providerModules = [
  githubProviderModule,
  linearProviderModule,
  posthogProviderModule,
  jamProviderModule,
  claapProviderModule,
  slackProviderModule,
  jiraProviderModule,
  clickupProviderModule,
  discordProviderModule,
  notionProviderModule,
  sentryProviderModule,
  giteaProviderModule,
  testVcsProviderModule,
  shipfoxProviderModule,
  cronProviderModule,
  webhookProviderModule,
];

export async function loadEnabledProviderModules(
  options: IntegrationProviderModuleLoadOptions = {},
): Promise<IntegrationModuleParts[]> {
  const parts: IntegrationModuleParts[] = [];
  for (const module of providerModules) {
    if (!module.enabled) continue;
    const loaded = await module.load(options);
    parts.push({
      ...loaded,
      ...(module.builtinConnection === undefined
        ? {}
        : {builtinConnection: module.builtinConnection}),
    });
  }
  return parts;
}
