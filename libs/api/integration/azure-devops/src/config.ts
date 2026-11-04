import {createConfig, num, url} from '@shipfox/config';

export const config = createConfig({
  AZURE_DEVOPS_BASE_URL: url({
    desc: 'Base URL of Azure DevOps Services that organization URLs are built from. Defaults to https://dev.azure.com; override it only to point tests or a proxy at another host.',
    default: 'https://dev.azure.com',
  }),
  AZURE_DEVOPS_WEBHOOK_BASE_URL: url({
    desc: 'Public base URL that Azure DevOps Service Hooks post to. The connect flow shows the full hook URL built from it. Development and test environments default to http://localhost:3000; production requires an explicit URL.',
    devDefault: 'http://localhost:3000',
  }),
  AZURE_DEVOPS_CHECKOUT_TTL_SECONDS: num({
    desc: 'Lifetime in seconds reported for the checkout credentials handed to the runner. The credential itself is the connection token; renewal happens when git rejects it. Must be at least 1. Defaults to 300 (five minutes).',
    default: 300,
  }),
  AZURE_DEVOPS_REQUEST_TIMEOUT_MS: num({
    desc: 'How long in milliseconds the provider waits for an Azure DevOps REST API response before giving up. A request that exceeds this fails as a timeout instead of holding an API worker open. Must be at least 1. Defaults to 10000 (ten seconds).',
    default: 10_000,
  }),
});

for (const key of [
  'AZURE_DEVOPS_CHECKOUT_TTL_SECONDS',
  'AZURE_DEVOPS_REQUEST_TIMEOUT_MS',
] as const) {
  // Zero or a negative value would make every request time out at once, or hand out credentials
  // that are already expired; fail at startup instead.
  if (!Number.isFinite(config[key]) || config[key] < 1) {
    throw new Error(`${key} must be a number of at least 1, got ${config[key]}`);
  }
}
