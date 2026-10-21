import {randomUUID} from 'node:crypto';
import type {ContractFiles, LoadedContractCase} from './contracts.js';
import {CONTRACT_FAKE_ADAPTERS} from './fakes/index.js';
import type {ContractFake, ContractFakeAdapter} from './fakes/shared.js';
import {runContractCase} from './run-case.js';

/**
 * What the provider packages require to load, none of which a tool call reads. The fakes add
 * the addresses the calls do read.
 */
const GATEWAY_ENV: Readonly<Record<string, string>> = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_USERNAME: 'shipfox',
  POSTGRES_PASSWORD: 'password',
  POSTGRES_DATABASE: 'api_test',
  SECRETS_ENCRYPTION_KEK: 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=',
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: 'contracts-private-key',
  GITHUB_APP_CLIENT_ID: 'contracts-client-id',
  GITHUB_APP_CLIENT_SECRET: 'contracts-client-secret',
  GITHUB_APP_WEBHOOK_SECRET: 'contracts-webhook-secret',
  GITHUB_APP_SLUG: 'shipfox-contracts',
  GITHUB_INSTALL_STATE_SECRET: 'contracts-install-state-secret',
  CLICKUP_OAUTH_CLIENT_ID: 'contracts-client-id',
  CLICKUP_OAUTH_CLIENT_SECRET: 'contracts-client-secret',
  CLICKUP_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/clickup/callback',
  CLICKUP_WEBHOOK_BASE_URL: 'https://shipfox.example.com',
  DISCORD_APPLICATION_ID: 'contracts-discord-application-id',
  DISCORD_OAUTH_CLIENT_SECRET: 'contracts-discord-client-secret',
  DISCORD_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/discord/callback',
  DISCORD_PUBLIC_KEY: 'contracts-discord-public-key',
  DISCORD_BOT_TOKEN: 'contracts-discord-bot-token',
  DISCORD_GATEWAY_ENABLED: 'false',
  NOTION_OAUTH_CLIENT_ID: 'contracts-client-id',
  NOTION_OAUTH_CLIENT_SECRET: 'contracts-client-secret',
  NOTION_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/notion/callback',
  JIRA_OAUTH_CLIENT_ID: 'contracts-client-id',
  JIRA_OAUTH_CLIENT_SECRET: 'contracts-client-secret',
  JIRA_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/jira/callback',
  JIRA_WEBHOOK_BASE_URL: 'https://shipfox.example.com',
  LINEAR_OAUTH_CLIENT_ID: 'contracts-client-id',
  LINEAR_OAUTH_CLIENT_SECRET: 'contracts-client-secret',
  LINEAR_WEBHOOK_SIGNING_SECRET: 'contracts-webhook-secret',
  LINEAR_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/linear/callback',
  SLACK_OAUTH_CLIENT_ID: 'contracts-client-id',
  SLACK_OAUTH_CLIENT_SECRET: 'contracts-client-secret',
  SLACK_SIGNING_SECRET: 'contracts-signing-secret',
  SLACK_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/slack/callback',
  GITEA_BASE_URL: 'https://gitea.example.com',
  GITEA_SERVICE_USERNAME: 'shipfox-bot',
  GITEA_SERVICE_TOKEN: 'contracts-service-token',
  GITEA_WEBHOOK_SECRET: 'contracts-webhook-secret',
  SENTRY_APP_CLIENT_ID: 'contracts-client-id',
  SENTRY_APP_CLIENT_SECRET: 'contracts-client-secret',
  SENTRY_APP_SLUG: 'shipfox-contracts',
};

export interface ContractStack {
  /** Runs one `fake` case against its provider's fake. Throws when the case fails. */
  run(loaded: LoadedContractCase): Promise<void>;
}

/** The `fake` cases of each provider, in id order. */
export function fakeCasesByProvider(files: ContractFiles): Map<string, LoadedContractCase[]> {
  const byProvider = new Map<string, LoadedContractCase[]>();
  const cases = files.cases
    .filter(({definition}) => definition.modes.includes('fake'))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const loaded of cases) {
    const provider = loaded.definition.provider;
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), loaded]);
  }
  return byProvider;
}

/**
 * Starts the fake of every provider with a `fake` case and seeds it from the sandbox fixtures,
 * then loads the gateway over them. A provider whose fake fails to start or seed fails its own
 * cases, and the others still run.
 */
export async function startContractStack({
  files,
  cleanups,
  adapters = CONTRACT_FAKE_ADAPTERS,
}: {
  files: ContractFiles;
  /** Run in reverse by the caller, however the suite ends. */
  cleanups: Array<() => Promise<void>>;
  adapters?: Readonly<Record<string, ContractFakeAdapter>>;
}): Promise<ContractStack> {
  const uniqueId = randomUUID().replaceAll('-', '').slice(0, 12);
  const fakes: Record<string, ContractFake> = {};
  const broken = new Map<string, string>();
  for (const provider of fakeCasesByProvider(files).keys()) {
    const adapter = adapters[provider];
    if (adapter === undefined) {
      broken.set(provider, `The ${provider} fake has no adapter for the contracts suite.`);
      continue;
    }
    try {
      const fake = await adapter({uniqueId, cleanups});
      await fake.seed(files.manifest[provider]?.fixtures ?? {});
      fake.deny?.(files.manifest[provider]?.targets ?? {});
      fakes[provider] = fake;
    } catch (error) {
      broken.set(provider, `The ${provider} fake could not start: ${errorMessage(error)}`);
    }
  }

  for (const [name, value] of Object.entries(GATEWAY_ENV)) process.env[name] ??= value;
  for (const fake of Object.values(fakes)) Object.assign(process.env, fake.env);
  const {createContractGateway} = await import('./gateway.js');
  const gateway = createContractGateway({fakes});

  return {
    run: async (loaded) => {
      const reason = broken.get(loaded.definition.provider);
      if (reason !== undefined) throw new Error(reason);
      await runContractCase({loaded, manifest: files.manifest, gateway});
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
