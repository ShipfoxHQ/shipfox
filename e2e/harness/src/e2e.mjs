#!/usr/bin/env node
import {generateKeyPairSync, randomBytes} from 'node:crypto';
import {cp, mkdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  collectE2eDiagnostics as collectHarnessE2eDiagnostics,
  defaultLogDir,
  e2eClickUpApiBaseUrl,
  e2eDiscordApiBaseUrl,
  e2eGithubApiBaseUrl,
  e2eJiraApiBaseUrl,
  e2eLinearMcpEndpoint,
  e2eNotionApiBaseUrl,
  e2ePosthogApiBaseUrl,
  e2ePosthogMcpEndpoint,
  e2eSlackApiBaseUrl,
  e2eTestVcsPort,
  parseArgs,
  runE2e,
  startFakeRouters,
} from './harness.mjs';
import {startPosthogMock} from './posthog-mock.mjs';
import {
  e2eRegistryEnv,
  e2eRegistryTrustedKeys,
  e2eRegistryUrl,
  registryServerArgs,
  seedLocalRegistry,
} from './registry.mjs';

const defaultE2eAdminApiKey = 'e2e-admin-api-key';
const defaultApiUrl = 'http://localhost:16101';
const defaultClientUrl = 'http://localhost:5173';
const defaultAuthSignupGateEnabled = 'true';
const defaultAuthSignupAllowedEmailDomains = 'allowed.example.test';
const defaultAuthSignupNotAllowedMessage = 'This E2E deployment does not accept new accounts.';
const trailingSlashPattern = /\/$/;
let generatedGithubAppPrivateKey;
let generatedDiscordSigningKeys;
let generatedE2eBootstrapToken;

if (isCliEntryPoint()) {
  main(process.argv.slice(2)).catch((error) => {
    printError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export async function main(argv) {
  const options = parseArgs(argv);
  const env = e2eEnv(process.env);
  const logDir = resolve(options.logDir ?? defaultLogDir(process.env));
  const registryEnv = {};
  let posthogMock;
  let fakeRouters = [];

  const servers = [
    {
      name: 'registry',
      command: process.execPath,
      args: registryServerArgs,
      env: registryEnv,
      ready: `${env.REGISTRY_URL}/readyz`,
      logFile: join(logDir, 'shipfox-registry.log'),
    },
    {
      name: 'api',
      command: 'pnpm',
      args: ['--filter=@shipfox/api', 'dev:e2e'],
      ready: `${env.API_URL.replace(trailingSlashPattern, '')}/readyz`,
      logFile: join(logDir, 'shipfox-api.log'),
    },
    {
      name: 'client',
      command: 'pnpm',
      args: ['--filter=@shipfox/client', 'dev'],
      ready: env.CLIENT_URL,
      logFile: join(logDir, 'shipfox-client.log'),
    },
  ];

  try {
    const exitCode = await runE2e({
      argv,
      env: () => env,
      servers,
      diagnostics: [(diagnosticsDir) => copySharedOllamaLog(diagnosticsDir)],
      beforeStart: async ({env: runEnv, logDir: runLogDir}) => {
        if (
          process.env.POSTHOG_API_BASE_URL === undefined &&
          process.env.POSTHOG_MCP_ENDPOINT === undefined
        ) {
          posthogMock = await startPosthogMock(new URL(runEnv.POSTHOG_API_BASE_URL));
        }
        fakeRouters = await startFakeRouters(runEnv);
        Object.assign(registryEnv, e2eRegistryEnv(runEnv));
        await seedLocalRegistry({
          env: registryEnv,
          logFile: join(runLogDir, 'shipfox-registry-seed.log'),
        });
      },
    });
    if (exitCode !== 0) process.exit(exitCode);
    return exitCode;
  } finally {
    if (!options.keepOpen) {
      await posthogMock?.stop().catch((error) => {
        printError(
          `Failed to stop PostHog E2E mock: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      await Promise.all(
        fakeRouters.map(async (router) => {
          await router.stop().catch((error) => {
            printError(
              `Failed to stop ${router.name} fake router: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }),
      );
    }
  }
}

function valueOr(value, fallback) {
  if (value !== undefined && value !== null) return value;
  return typeof fallback === 'function' ? fallback() : fallback;
}

export function e2eEnv(sourceEnv) {
  const hasPosthogApiBaseUrl = sourceEnv.POSTHOG_API_BASE_URL !== undefined;
  const hasPosthogMcpEndpoint = sourceEnv.POSTHOG_MCP_ENDPOINT !== undefined;
  if (hasPosthogApiBaseUrl !== hasPosthogMcpEndpoint) {
    throw new Error(
      'POSTHOG_API_BASE_URL and POSTHOG_MCP_ENDPOINT must be configured together for E2E runs.',
    );
  }

  const apiUrl = valueOr(sourceEnv.API_URL, valueOr(sourceEnv.SHIPFOX_API_URL, defaultApiUrl));
  const clientUrl = valueOr(
    sourceEnv.CLIENT_URL,
    valueOr(sourceEnv.CLIENT_BASE_URL, defaultClientUrl),
  );
  const giteaUrl = valueOr(
    sourceEnv.E2E_GITEA_URL,
    valueOr(sourceEnv.GITEA_BASE_URL, 'http://localhost:3000'),
  );
  const linearMcpEndpoint = valueOr(sourceEnv.LINEAR_MCP_ENDPOINT, () =>
    e2eLinearMcpEndpoint(apiUrl),
  );
  const githubApiBaseUrl = valueOr(sourceEnv.GITHUB_API_BASE_URL, () =>
    e2eGithubApiBaseUrl(apiUrl),
  );
  const slackApiBaseUrl = valueOr(sourceEnv.SLACK_API_BASE_URL, () => e2eSlackApiBaseUrl(apiUrl));
  const clickupApiBaseUrl = valueOr(sourceEnv.CLICKUP_API_BASE_URL, () =>
    e2eClickUpApiBaseUrl(apiUrl),
  );
  const notionApiBaseUrl = valueOr(sourceEnv.NOTION_API_BASE_URL, () =>
    e2eNotionApiBaseUrl(apiUrl),
  );
  const jiraApiBaseUrl = valueOr(sourceEnv.JIRA_API_BASE_URL, () => e2eJiraApiBaseUrl(apiUrl));
  const discordApiBaseUrl = valueOr(sourceEnv.DISCORD_API_BASE_URL, () =>
    e2eDiscordApiBaseUrl(apiUrl),
  );
  const testVcsPort = valueOr(sourceEnv.INTEGRATIONS_TEST_VCS_PORT, () => e2eTestVcsPort(apiUrl));
  const posthogApiBaseUrl = valueOr(sourceEnv.POSTHOG_API_BASE_URL, () =>
    e2ePosthogApiBaseUrl(apiUrl),
  );
  const posthogMcpEndpoint = valueOr(sourceEnv.POSTHOG_MCP_ENDPOINT, () =>
    e2ePosthogMcpEndpoint(apiUrl),
  );
  return {
    ...sourceEnv,
    API_URL: apiUrl,
    API_PUBLIC_URL: valueOr(sourceEnv.API_PUBLIC_URL, apiUrl),
    CLIENT_BASE_URL: valueOr(sourceEnv.CLIENT_BASE_URL, clientUrl),
    CLIENT_URL: clientUrl,
    E2E_ADMIN_API_KEY: valueOr(sourceEnv.E2E_ADMIN_API_KEY, defaultE2eAdminApiKey),
    E2E_ENABLED: valueOr(sourceEnv.E2E_ENABLED, 'true'),
    E2E_MANAGED_PROVIDER_BASE_URL: valueOr(
      sourceEnv.E2E_MANAGED_PROVIDER_BASE_URL,
      `${apiUrl}/__e2e-managed-inference`,
    ),
    AUTH_ROOT_KEY: valueOr(sourceEnv.AUTH_ROOT_KEY, 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
    // The flow suite shares one access token across its long-running scenarios.
    // Keep the test deployment alive longer than the CI job while preserving
    // explicit caller overrides.
    AUTH_JWT_EXPIRES_IN: valueOr(sourceEnv.AUTH_JWT_EXPIRES_IN, '1h'),
    // Impersonation ships disabled by default; the E2E deployment opts in so
    // the mint route is live for the suite that exercises it. The admin
    // bootstrap token is generated per run and never defaults to a well-known
    // literal: claiming the first admin owner requires knowing it, so a
    // harness-defaulted deployment is not bootstrap-able by anyone with
    // repository access.
    AUTH_IMPERSONATION_ENABLED: valueOr(sourceEnv.AUTH_IMPERSONATION_ENABLED, 'true'),
    // Workflow actions stay dark in production until launch. Its `devDefault` does not
    // apply here, because the E2E API runs without NODE_ENV.
    DEFINITION_ACTIONS_ENABLED: valueOr(sourceEnv.DEFINITION_ACTIONS_ENABLED, 'true'),
    // The harness builds the API before it starts it, so the workflow bundles
    // already exist. Compiling them again at worker startup takes most of the boot.
    TEMPORAL_PREBUILT_WORKFLOW_BUNDLES: valueOr(
      sourceEnv.TEMPORAL_PREBUILT_WORKFLOW_BUNDLES,
      'true',
    ),
    // The harness starts this registry, which signs with a key generated for the run.
    REGISTRY_URL: e2eRegistryUrl(apiUrl),
    REGISTRY_TRUSTED_KEYS: e2eRegistryTrustedKeys(),
    ADMIN_BOOTSTRAP_TOKEN: valueOr(sourceEnv.ADMIN_BOOTSTRAP_TOKEN, e2eBootstrapToken),
    AUTH_SIGNUP_GATE_ENABLED: valueOr(
      sourceEnv.AUTH_SIGNUP_GATE_ENABLED,
      defaultAuthSignupGateEnabled,
    ),
    AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS: valueOr(
      sourceEnv.AUTH_SIGNUP_ALLOWED_EMAIL_DOMAINS,
      defaultAuthSignupAllowedEmailDomains,
    ),
    AUTH_SIGNUP_NOT_ALLOWED_MESSAGE: valueOr(
      sourceEnv.AUTH_SIGNUP_NOT_ALLOWED_MESSAGE,
      defaultAuthSignupNotAllowedMessage,
    ),
    E2E_GITEA_URL: giteaUrl,
    GITEA_CLONE_BASE_URL: valueOr(sourceEnv.GITEA_CLONE_BASE_URL, giteaUrl),
    HOST: valueOr(sourceEnv.HOST, '0.0.0.0'),
    GITHUB_API_BASE_URL: githubApiBaseUrl,
    GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE: valueOr(
      sourceEnv.GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE,
      'enabled',
    ),
    GITHUB_APP_CLIENT_ID: valueOr(sourceEnv.GITHUB_APP_CLIENT_ID, 'e2e-github-client-id'),
    GITHUB_APP_CLIENT_SECRET: valueOr(
      sourceEnv.GITHUB_APP_CLIENT_SECRET,
      'e2e-github-client-secret',
    ),
    GITHUB_APP_ID: valueOr(sourceEnv.GITHUB_APP_ID, '1'),
    GITHUB_APP_PRIVATE_KEY: valueOr(sourceEnv.GITHUB_APP_PRIVATE_KEY, e2eGithubAppPrivateKey),
    GITHUB_APP_SLUG: valueOr(sourceEnv.GITHUB_APP_SLUG, 'shipfox-e2e'),
    GITHUB_APP_USERNAME: valueOr(sourceEnv.GITHUB_APP_USERNAME, 'shipfox-e2e'),
    GITHUB_APP_WEBHOOK_SECRET: valueOr(
      sourceEnv.GITHUB_APP_WEBHOOK_SECRET,
      'e2e-github-webhook-secret',
    ),
    GITHUB_INSTALL_STATE_SECRET: valueOr(
      sourceEnv.GITHUB_INSTALL_STATE_SECRET,
      'e2e-github-install-state-secret',
    ),
    CLICKUP_API_BASE_URL: clickupApiBaseUrl,
    JIRA_API_BASE_URL: jiraApiBaseUrl,
    DISCORD_API_BASE_URL: discordApiBaseUrl,
    DISCORD_APPLICATION_ID: valueOr(sourceEnv.DISCORD_APPLICATION_ID, 'e2e-discord-application-id'),
    DISCORD_BOT_TOKEN: valueOr(sourceEnv.DISCORD_BOT_TOKEN, 'e2e-discord-bot-token'),
    DISCORD_GATEWAY_ENABLED: valueOr(sourceEnv.DISCORD_GATEWAY_ENABLED, 'false'),
    DISCORD_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.DISCORD_OAUTH_CLIENT_SECRET,
      'e2e-discord-client-secret',
    ),
    DISCORD_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.DISCORD_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/discord/callback`,
    ),
    DISCORD_PUBLIC_KEY: valueOr(sourceEnv.DISCORD_PUBLIC_KEY, () => e2eDiscordSigningKeys().publicKey),
    // The interaction sender in `@shipfox/e2e-driver-discord` signs with this key.
    E2E_DISCORD_PRIVATE_KEY: valueOr(
      sourceEnv.E2E_DISCORD_PRIVATE_KEY,
      () => e2eDiscordSigningKeys().privateKey,
    ),
    POSTHOG_API_BASE_URL: posthogApiBaseUrl,
    POSTHOG_MCP_ENDPOINT: posthogMcpEndpoint,
    CLICKUP_AUTH_BASE_URL: valueOr(sourceEnv.CLICKUP_AUTH_BASE_URL, 'https://app.clickup.com'),
    CLICKUP_OAUTH_CLIENT_ID: valueOr(sourceEnv.CLICKUP_OAUTH_CLIENT_ID, 'e2e-clickup-client-id'),
    CLICKUP_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.CLICKUP_OAUTH_CLIENT_SECRET,
      'e2e-clickup-client-secret',
    ),
    CLICKUP_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.CLICKUP_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/clickup/callback`,
    ),
    CLICKUP_WEBHOOK_BASE_URL: valueOr(sourceEnv.CLICKUP_WEBHOOK_BASE_URL, apiUrl),
    NOTION_API_BASE_URL: notionApiBaseUrl,
    NOTION_OAUTH_CLIENT_ID: valueOr(sourceEnv.NOTION_OAUTH_CLIENT_ID, 'e2e-notion-client-id'),
    NOTION_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.NOTION_OAUTH_CLIENT_SECRET,
      'e2e-notion-client-secret',
    ),
    NOTION_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.NOTION_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/notion/callback`,
    ),
    NOTION_WEBHOOK_VERIFICATION_TOKEN: valueOr(
      sourceEnv.NOTION_WEBHOOK_VERIFICATION_TOKEN,
      'e2e-notion-verification-token',
    ),
    INTEGRATIONS_ENABLE_GITHUB_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_GITHUB_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_LINEAR_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_LINEAR_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_JIRA_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_JIRA_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_SENTRY_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_SENTRY_PROVIDER,
      'true',
    ),
    SENTRY_APP_CLIENT_ID: valueOr(sourceEnv.SENTRY_APP_CLIENT_ID, 'e2e-sentry-client-id'),
    SENTRY_APP_CLIENT_SECRET: valueOr(
      sourceEnv.SENTRY_APP_CLIENT_SECRET,
      'e2e-sentry-client-secret',
    ),
    SENTRY_APP_SLUG: valueOr(sourceEnv.SENTRY_APP_SLUG, 'shipfox-e2e'),
    INTEGRATIONS_ENABLE_SLACK_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_SLACK_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_CLICKUP_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_CLICKUP_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_DISCORD_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_DISCORD_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_NOTION_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_NOTION_PROVIDER,
      'true',
    ),
    INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER: valueOr(
      sourceEnv.INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER,
      'true',
    ),
    JIRA_OAUTH_CLIENT_ID: valueOr(sourceEnv.JIRA_OAUTH_CLIENT_ID, 'e2e-jira-client-id'),
    JIRA_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.JIRA_OAUTH_CLIENT_SECRET,
      'e2e-jira-client-secret',
    ),
    JIRA_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.JIRA_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/jira/callback`,
    ),
    JIRA_WEBHOOK_BASE_URL: valueOr(sourceEnv.JIRA_WEBHOOK_BASE_URL, apiUrl),
    INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS: valueOr(
      sourceEnv.INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS,
      '600',
    ),
    INTEGRATIONS_TEST_VCS_PORT: String(testVcsPort),
    LINEAR_MCP_ENDPOINT: linearMcpEndpoint,
    LINEAR_UPLOADS_URL: valueOr(sourceEnv.LINEAR_UPLOADS_URL, () =>
      new URL('/uploads/', linearMcpEndpoint).toString(),
    ),
    LINEAR_UPLOADS_ALLOW_PRIVATE_NETWORKS: valueOr(
      sourceEnv.LINEAR_UPLOADS_ALLOW_PRIVATE_NETWORKS,
      'true',
    ),
    LINEAR_OAUTH_CLIENT_ID: valueOr(sourceEnv.LINEAR_OAUTH_CLIENT_ID, 'e2e-linear-client-id'),
    LINEAR_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.LINEAR_OAUTH_CLIENT_SECRET,
      'e2e-linear-client-secret',
    ),
    LINEAR_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.LINEAR_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/linear/callback`,
    ),
    LINEAR_WEBHOOK_SIGNING_SECRET: valueOr(
      sourceEnv.LINEAR_WEBHOOK_SIGNING_SECRET,
      'e2e-linear-webhook-secret',
    ),
    SLACK_API_BASE_URL: slackApiBaseUrl,
    SLACK_OAUTH_CLIENT_ID: valueOr(sourceEnv.SLACK_OAUTH_CLIENT_ID, 'e2e-slack-client-id'),
    SLACK_OAUTH_CLIENT_SECRET: valueOr(
      sourceEnv.SLACK_OAUTH_CLIENT_SECRET,
      'e2e-slack-client-secret',
    ),
    SLACK_OAUTH_REDIRECT_URL: valueOr(
      sourceEnv.SLACK_OAUTH_REDIRECT_URL,
      `${clientUrl}/integrations/slack/callback`,
    ),
    SLACK_SIGNING_SECRET: valueOr(sourceEnv.SLACK_SIGNING_SECRET, 'e2e-slack-signing-secret'),
    VITE_API_URL: valueOr(sourceEnv.VITE_API_URL, apiUrl),
    VITE_ENABLE_TEST_VCS_PROVIDER: valueOr(sourceEnv.VITE_ENABLE_TEST_VCS_PROVIDER, 'true'),
    WEBHOOK_PUBLIC_URL: valueOr(sourceEnv.WEBHOOK_PUBLIC_URL, apiUrl),
  };
}

function e2eGithubAppPrivateKey() {
  generatedGithubAppPrivateKey ??= generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
    publicKeyEncoding: {format: 'pem', type: 'spki'},
  }).privateKey;
  return generatedGithubAppPrivateKey;
}

// Discord verifies interactions against a raw hex Ed25519 public key. The private key is a
// base64 PKCS#8 DER document.
function e2eDiscordSigningKeys() {
  if (!generatedDiscordSigningKeys) {
    const {publicKey, privateKey} = generateKeyPairSync('ed25519');
    generatedDiscordSigningKeys = {
      publicKey: publicKey.export({format: 'der', type: 'spki'}).subarray(-32).toString('hex'),
      privateKey: privateKey.export({format: 'der', type: 'pkcs8'}).toString('base64'),
    };
  }
  return generatedDiscordSigningKeys;
}

function e2eBootstrapToken() {
  generatedE2eBootstrapToken ??= randomBytes(32).toString('base64url');
  return generatedE2eBootstrapToken;
}

export async function collectE2eDiagnostics(logDir) {
  await collectHarnessE2eDiagnostics(logDir);
  await copySharedOllamaLog(logDir);
}

export async function copySharedOllamaLog(logDir, env = process.env, cwd = process.cwd()) {
  const rootPath = resolve(env.CONDUCTOR_ROOT_PATH || cwd);
  const source = join(rootPath, '.context/shared-ollama/ollama.log');
  const target = join(logDir, 'shared-ollama/ollama.log');

  try {
    await mkdir(dirname(target), {recursive: true});
    await cp(source, target, {force: true});
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function isCliEntryPoint() {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}
