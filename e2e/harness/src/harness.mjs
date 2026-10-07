import {spawn, spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {closeSync, openSync} from 'node:fs';
import {cp, mkdir, readdir, stat} from 'node:fs/promises';
import {connect as tcpConnect} from 'node:net';
import {dirname, join, resolve} from 'node:path';
import {startFakeRouter} from './fake-router.mjs';

const defaultApiUrl = 'http://localhost:16101';
const defaultClientUrl = 'http://localhost:5173';
const defaultReadinessTimeoutMs = 60_000;
const defaultShutdownTimeoutMs = 15_000;
const defaultTurboTask = 'test:e2e';
const evalTurboTask = 'evals';
const defaultE2eBuildFilter = '@shipfox/e2e-*...';
const fakeRouterEnvNames = {
  github: 'GITHUB_API_BASE_URL',
  slack: 'SLACK_API_BASE_URL',
  linear: 'LINEAR_MCP_ENDPOINT',
  jira: 'JIRA_API_BASE_URL',
  clickup: 'CLICKUP_API_BASE_URL',
  notion: 'NOTION_API_BASE_URL',
};

let generatedE2eAdminApiKey;
let generatedE2eBootstrapToken;

/**
 * Runs a repository's E2E stack and test task.
 *
 * Servers start in dependency order. A server with a `ready` URL is checked before the next
 * server starts. The returned exit code is the Turbo task exit code.
 */
export async function runE2e({
  argv = [],
  env = baseE2eEnv,
  servers = [],
  diagnostics = [],
  beforeStart,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  const resolvedEnv = typeof env === 'function' ? env(process.env) : env;
  const logDir = resolve(options.logDir ?? defaultLogDir(resolvedEnv));
  const runningServers = [];
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (signal) printLine(`Received ${signal}; stopping E2E dev servers.`);
    await stopServers(runningServers);
  };
  const onSigint = () => shutdown('SIGINT').finally(() => process.exit(130));
  const onSigterm = () => shutdown('SIGTERM').finally(() => process.exit(143));

  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    await mkdir(logDir, {recursive: true});
    if (options.turboTask === defaultTurboTask || options.turboTask === evalTurboTask) {
      await buildE2eDependencies(options, resolvedEnv, runningServers, logDir);
    }

    await beforeStart?.({env: resolvedEnv, logDir});
    const orderedServers = orderServers(servers);
    await checkServerPorts(orderedServers, resolvedEnv);
    for (const definition of orderedServers) {
      const server = await startServer({
        ...definition,
        env: {...resolvedEnv, ...(definition.env ?? {})},
        logFile: definition.logFile ?? join(logDir, `shipfox-${definition.name}.log`),
      });
      runningServers.push(server);
      if (definition.ready !== undefined) {
        await waitForReady(definition.ready, resolvedEnv, options.readinessTimeoutMs);
      }
    }

    const task = await startCommand('turbo', turboCommandArgs(options, resolvedEnv), {
      env: resolvedEnv,
      stdio: 'inherit',
    });
    runningServers.push({name: 'tests', child: task.child});
    const exitCode = await task.exitCode;
    if (exitCode !== 0) await runDiagnostics(diagnostics, logDir);
    return exitCode;
  } catch (error) {
    await runDiagnostics(diagnostics, logDir);
    throw error;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    if (!options.keepOpen) await shutdown();
  }
}

/** Builds the consumer-neutral environment required by a local E2E deployment. */
export function baseE2eEnv(sourceEnv = {}) {
  const apiUrl = valueOr(sourceEnv.API_URL, valueOr(sourceEnv.SHIPFOX_API_URL, defaultApiUrl));
  const clientUrl = valueOr(
    sourceEnv.CLIENT_URL,
    valueOr(sourceEnv.CLIENT_BASE_URL, defaultClientUrl),
  );
  assertLocalUrl(apiUrl, 'API_URL');
  assertLocalUrl(clientUrl, 'CLIENT_URL');

  return {
    ...sourceEnv,
    API_URL: apiUrl,
    API_PUBLIC_URL: valueOr(sourceEnv.API_PUBLIC_URL, apiUrl),
    CLIENT_BASE_URL: valueOr(sourceEnv.CLIENT_BASE_URL, clientUrl),
    CLIENT_URL: clientUrl,
    E2E_ADMIN_API_KEY: valueOr(sourceEnv.E2E_ADMIN_API_KEY, e2eAdminApiKey),
    E2E_ENABLED: valueOr(sourceEnv.E2E_ENABLED, 'true'),
    E2E_MANAGED_PROVIDER_BASE_URL: valueOr(
      sourceEnv.E2E_MANAGED_PROVIDER_BASE_URL,
      `${apiUrl}/__e2e-managed-inference`,
    ),
    AUTH_ROOT_KEY: valueOr(sourceEnv.AUTH_ROOT_KEY, 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
    ADMIN_BOOTSTRAP_TOKEN: valueOr(sourceEnv.ADMIN_BOOTSTRAP_TOKEN, e2eBootstrapToken),
    HOST: valueOr(sourceEnv.HOST, '0.0.0.0'),
    GITHUB_API_BASE_URL: valueOr(sourceEnv.GITHUB_API_BASE_URL, () => e2eGithubApiBaseUrl(apiUrl)),
    SLACK_API_BASE_URL: valueOr(sourceEnv.SLACK_API_BASE_URL, () => e2eSlackApiBaseUrl(apiUrl)),
    LINEAR_MCP_ENDPOINT: valueOr(sourceEnv.LINEAR_MCP_ENDPOINT, () => e2eLinearMcpEndpoint(apiUrl)),
    JIRA_API_BASE_URL: valueOr(sourceEnv.JIRA_API_BASE_URL, () => e2eJiraApiBaseUrl(apiUrl)),
    CLICKUP_API_BASE_URL: valueOr(sourceEnv.CLICKUP_API_BASE_URL, () => e2eClickUpApiBaseUrl(apiUrl)),
    NOTION_API_BASE_URL: valueOr(sourceEnv.NOTION_API_BASE_URL, () => e2eNotionApiBaseUrl(apiUrl)),
  };
}

function valueOr(value, fallback) {
  if (value !== undefined && value !== null) return value;
  return typeof fallback === 'function' ? fallback() : fallback;
}

function e2eAdminApiKey() {
  generatedE2eAdminApiKey ??= randomBytes(32).toString('base64url');
  return generatedE2eAdminApiKey;
}

function e2eBootstrapToken() {
  generatedE2eBootstrapToken ??= randomBytes(32).toString('base64url');
  return generatedE2eBootstrapToken;
}

function assertLocalUrl(value, name) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error(`${name} must target a local host for an E2E run.`);
  }
}

function orderServers(servers) {
  const definitions = [...servers];
  const byName = new Map(definitions.map((server) => [server.name, server]));
  const dependencies = new Map(definitions.map((server) => [server.name, new Set()]));
  for (const server of definitions) {
    if (server.before === undefined) continue;
    if (!byName.has(server.before)) throw new Error(`${server.name} refers to unknown server ${server.before}.`);
    dependencies.get(server.before).add(server.name);
  }
  const ordered = [];
  while (ordered.length < definitions.length) {
    const next = definitions.find(
      (server) => !ordered.includes(server) && [...dependencies.get(server.name)].every((name) => ordered.some((item) => item.name === name)),
    );
    if (next === undefined) throw new Error('E2E server ordering contains a cycle.');
    ordered.push(next);
  }
  return ordered;
}

async function checkServerPorts(servers, env) {
  const ports = new Set();
  for (const server of servers) {
    if (server.ready === undefined) continue;
    const readyUrl = resolveReadyUrl(server.ready, env);
    const port = Number(readyUrl.port || (readyUrl.protocol === 'https:' ? 443 : 80));
    if (readyUrl.port === '0') continue;
    const key = `${readyUrl.hostname}:${port}`;
    if (ports.has(key)) throw new Error(`E2E servers share port ${key}.`);
    ports.add(key);
    if (await isPortOpen(readyUrl.hostname, port)) {
      throw new Error(`E2E server port ${key} is already in use.`);
    }
  }
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = tcpConnect({host, port});
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(100);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function resolveReadyUrl(ready, env) {
  const value = typeof ready === 'function' ? ready(env) : ready;
  return new URL(value, env.API_URL);
}

async function waitForReady(ready, env, timeoutMs) {
  await waitForUrl(resolveReadyUrl(ready, env).toString(), {timeoutMs});
}

async function runDiagnostics(diagnostics, logDir) {
  await Promise.allSettled(
    [collectE2eDiagnostics, ...diagnostics].map(async (diagnostic) => {
      try {
        await diagnostic(logDir);
      } catch (error) {
        printError(
          `Failed to collect E2E diagnostics: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}

export function parseArgs(argv) {
  const args = [...argv];
  let command = 'run';
  if (args[0] && !args[0].startsWith('-')) command = args.shift();
  if (command !== 'run') {
    throw new Error(`Unknown command: ${command}`);
  }

  const options = {
    help: false,
    keepOpen: false,
    logDir: undefined,
    readinessTimeoutMs: defaultReadinessTimeoutMs,
    turboArgs: [],
    turboTask: defaultTurboTask,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      const passthroughArgs = args.slice(index + 1);
      options.turboArgs.push(
        ...(options.turboArgs.length === 0 ? passthroughArgs : ['--', ...passthroughArgs]),
      );
      break;
    }
    if (applyBooleanOption(arg, options)) continue;
    const valueOptionIndex = applyValueOption(args, index, arg, options);
    if (valueOptionIndex !== null) {
      index = valueOptionIndex;
      continue;
    }
    if (applyInlineOption(arg, options)) continue;

    options.turboArgs.push(arg);
  }

  return options;
}

function applyBooleanOption(arg, options) {
  if (arg === '--help' || arg === '-h') {
    options.help = true;
    return true;
  }
  if (arg === '--keep-open') {
    options.keepOpen = true;
    return true;
  }
  return false;
}

function applyValueOption(args, index, arg, options) {
  if (arg === '--log-dir') {
    options.logDir = requireValue(args, index + 1, arg);
    return index + 1;
  }
  if (arg === '--timeout-ms') {
    options.readinessTimeoutMs = parsePositiveInteger(requireValue(args, index + 1, arg), arg);
    return index + 1;
  }
  if (arg === '--task') {
    options.turboTask = requireValue(args, index + 1, arg);
    return index + 1;
  }
  return null;
}

function applyInlineOption(arg, options) {
  if (arg.startsWith('--log-dir=')) {
    options.logDir = arg.slice('--log-dir='.length);
    return true;
  }
  if (arg.startsWith('--timeout-ms=')) {
    options.readinessTimeoutMs = parsePositiveInteger(
      arg.slice('--timeout-ms='.length),
      '--timeout-ms',
    );
    return true;
  }
  if (arg.startsWith('--task=')) {
    options.turboTask = arg.slice('--task='.length);
    return true;
  }
  return false;
}

/** One router per provider fake, at the address the API reads for it. */
export async function startFakeRouters(env) {
  const routers = [];
  try {
    for (const [name, envName] of Object.entries(fakeRouterEnvNames)) {
      const router = await startFakeRouter({name, endpoint: new URL(env[envName])});
      routers.push({name, stop: router.stop});
    }
  } catch (error) {
    await Promise.allSettled(routers.map((router) => router.stop()));
    throw error;
  }
  return routers;
}

export function e2eGithubApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const githubApiPort = apiPort + 10;
  if (githubApiPort > 65_535) {
    throw new Error(`Cannot derive a GitHub API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(githubApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2eClickUpApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const clickupApiPort = apiPort + 13;
  if (clickupApiPort > 65_535) {
    throw new Error(`Cannot derive a ClickUp API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(clickupApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2eDiscordApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  // After Jira at API + 18, in a 25-port worktree block that ends at API + 23.
  const discordApiPort = apiPort + 19;
  if (discordApiPort > 65_535) {
    throw new Error(`Cannot derive a Discord API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(discordApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2eJiraApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  // After the registry at API + 17.
  const jiraApiPort = apiPort + 18;
  if (jiraApiPort > 65_535) {
    throw new Error(`Cannot derive a Jira API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(jiraApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2eNotionApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const notionApiPort = apiPort + 15;
  if (notionApiPort > 65_535) {
    throw new Error(`Cannot derive a Notion API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(notionApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2ePosthogApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const posthogPort = apiPort + 16;
  if (posthogPort > 65_535) {
    throw new Error(`Cannot derive a PostHog mock port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(posthogPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2ePosthogMcpEndpoint(apiUrl) {
  const endpoint = new URL(e2ePosthogApiBaseUrl(apiUrl));
  endpoint.pathname = '/mcp';
  return endpoint.toString();
}

export function e2eTestVcsPort(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  // Worktree services reserve the API block through the temporal metrics port
  // at API + 12. Keep the fixture in the unused tail of that block.
  const testVcsPort = apiPort + 14;
  if (testVcsPort > 65_535) {
    throw new Error(`Cannot derive a test VCS port from API port ${apiPort}.`);
  }
  return testVcsPort;
}

export function e2eSlackApiBaseUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const slackApiPort = apiPort + 11;
  if (slackApiPort > 65_535) {
    throw new Error(`Cannot derive a Slack API port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(slackApiPort);
  endpoint.pathname = '/';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function e2eLinearMcpEndpoint(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const linearMcpPort = apiPort + 9;
  if (linearMcpPort > 65_535) {
    throw new Error(`Cannot derive a Linear MCP port from API port ${apiPort}.`);
  }
  endpoint.hostname = '127.0.0.1';
  endpoint.port = String(linearMcpPort);
  endpoint.pathname = '/mcp';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

export function turboCommandArgs(options, env) {
  const taskArgs =
    options.turboTask === evalTurboTask && options.turboArgs.length > 0
      ? [options.turboTask, '--', ...options.turboArgs]
      : [options.turboTask, ...options.turboArgs];
  return withTurboConcurrency(taskArgs, env);
}

export function turboBuildCommandArgs(options, env) {
  const separatorIndex = options.turboArgs.indexOf('--');
  const turboArgs =
    separatorIndex < 0 ? options.turboArgs : options.turboArgs.slice(0, separatorIndex);
  const buildOptions =
    options.turboTask === evalTurboTask ? [] : withoutTurboFilters(turboArgs);
  return withTurboConcurrency(['build', `--filter=${defaultE2eBuildFilter}`, ...buildOptions], env);
}

function withoutTurboFilters(args) {
  const buildOptions = [];
  let skipNextFilterValue = false;
  for (const arg of args) {
    if (skipNextFilterValue) {
      skipNextFilterValue = false;
      continue;
    }
    if (arg === '--filter') {
      skipNextFilterValue = true;
      continue;
    }
    if (arg?.startsWith('--filter=')) continue;
    buildOptions.push(arg);
  }
  return buildOptions;
}

function withTurboConcurrency(args, env) {
  if (hasTurboConcurrency(args)) return args;

  const concurrency = env.SHIPFOX_TURBO_CONCURRENCY;
  if (!concurrency) return args;

  const separatorIndex = args.indexOf('--');
  if (separatorIndex < 0) return [...args, `--concurrency=${concurrency}`];
  return [
    ...args.slice(0, separatorIndex),
    `--concurrency=${concurrency}`,
    ...args.slice(separatorIndex),
  ];
}

function hasTurboConcurrency(args) {
  const separatorIndex = args.indexOf('--');
  const turboArgs = separatorIndex < 0 ? args : args.slice(0, separatorIndex);
  return turboArgs.some((arg) => arg === '--concurrency' || arg.startsWith('--concurrency='));
}

export function defaultLogDir(env) {
  return join(env.RUNNER_TEMP ?? '.context', 'shipfox-e2e-logs');
}

async function buildE2eDependencies(options, env, servers) {
  const build = await startCommand('turbo', turboBuildCommandArgs(options, env), {
    env,
    stdio: 'inherit',
  });
  servers.push({name: 'build', child: build.child});
  const exitCode = await build.exitCode;
  if (exitCode !== 0) {
    throw new Error(`E2E dependency build failed with exit code ${exitCode}`);
  }
}

async function startServer(params) {
  await mkdir(dirname(params.logFile), {recursive: true});
  const logFd = openSync(params.logFile, 'a');
  let child;
  try {
    child = spawn(params.command, params.args, {
      detached: process.platform !== 'win32',
      env: params.env,
      stdio: ['ignore', logFd, logFd],
    });
    const started = new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    await started;
  } finally {
    closeSync(logFd);
  }

  if (child.pid === undefined) throw new Error(`Failed to start ${params.name}`);
  return {name: params.name, child, logFile: params.logFile};
}

export async function startCommand(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
  });
  let resolveStarted;
  let rejectStarted;
  const started = new Promise((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const exitCode = new Promise((resolve) => {
    child.once('spawn', resolveStarted);
    child.once('error', (error) => {
      rejectStarted(error);
      resolve(1);
    });
    child.once('exit', (code) => resolve(code ?? 1));
  });
  await started;
  return {child, exitCode};
}

async function stopServers(servers) {
  await Promise.allSettled(servers.map((server) => stopServer(server)));
}

function stopServer(server) {
  const {child} = server;
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  const exited = new Promise((resolve) => child.once('exit', resolve));
  killChild(child, 'SIGTERM');

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      killChild(child, 'SIGKILL');
      exited.then(resolve);
    }, defaultShutdownTimeoutMs);
    exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function killChild(child, signal) {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // Already exited.
  }
}

export async function waitForUrl(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? defaultReadinessTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }

  throw new Error(
    `Timed out waiting for ${url}${lastError instanceof Error ? ` (${lastError.message})` : ''}`,
  );
}

export async function collectE2eDiagnostics(logDir) {
  const diagnosticsDir = join(logDir, 'docker');
  await mkdir(diagnosticsDir, {recursive: true});

  await Promise.all([
    writeCommandOutput('docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], {
      file: join(diagnosticsDir, 'containers.jsonl'),
    }),
    writeCommandOutput('docker', ['images', '--digests'], {
      file: join(diagnosticsDir, 'images.txt'),
    }),
    writeCommandOutput('docker', ['network', 'ls'], {
      file: join(diagnosticsDir, 'networks.txt'),
    }),
    writeCommandOutput('docker', ['network', 'inspect', 'bridge'], {
      file: join(diagnosticsDir, 'network-bridge.json'),
    }),
  ]);

  const runnerLogs = 'e2e/suites/flow/workflows/.e2e-run/runners';
  try {
    await cp(runnerLogs, join(logDir, 'flow-workflow-runners'), {
      recursive: true,
      force: true,
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await copyPlaywrightTestResults(logDir);
}

export async function copyPlaywrightTestResults(logDir) {
  const suiteLevelDirs = ['e2e/suites/api', 'e2e/suites/client', 'e2e/suites/flow'];

  for (const suiteLevelDir of suiteLevelDirs) {
    let entries;
    try {
      entries = await readdir(suiteLevelDir, {withFileTypes: true});
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const source = join(suiteLevelDir, entry.name, 'test-results');
      if (!(await isDirectory(source))) continue;

      await cp(source, join(logDir, 'playwright-test-results', source), {
        recursive: true,
        force: true,
      });
    }
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeCommandOutput(command, args, options) {
  await mkdir(dirname(options.file), {recursive: true});
  const outputFd = openSync(options.file, 'w');
  try {
    const result = spawnSync(command, args, {stdio: ['ignore', outputFd, outputFd]});
    if (result.error) {
      // Best-effort diagnostics: write the error only if the command could not start.
      printError(`${command} ${args.join(' ')} failed: ${result.error.message}`);
    }
  } finally {
    closeSync(outputFd);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(raw, flag) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function usage() {
  printLine(`Usage: mise run e2e [options] [turbo args]

Options:
  --filter=<package>      Passed through to turbo, for example --filter=@shipfox/e2e-flow-workflows
  --keep-open             Leave API and client dev servers running after tests
  --log-dir=<path>        Directory for API/client logs and failure diagnostics
  --task=<task>           Turbo task to run (default: test:e2e)
  --timeout-ms=<ms>       Readiness timeout for API and client (default: 60000)

Examples:
  mise run e2e -- --filter=@shipfox/e2e-flow-workflows
  mise run e2e -- --filter=@shipfox/e2e-client-auth
`);
}

function printLine(message) {
  process.stdout.write(`${message}\n`);
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}
