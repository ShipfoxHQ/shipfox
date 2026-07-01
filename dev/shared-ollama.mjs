#!/usr/bin/env node
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultModel = 'qwen3.5:0.8b';
const defaultKeepAlive = '24h';
const defaultBaseUrl = 'http://127.0.0.1:11434';
const startupTimeoutMs = 30_000;
const pollIntervalMs = 500;

if (isCliEntryPoint()) {
  await main(process.argv[2]);
}

export async function main(command) {
  const commands = new Set(['up', 'stop', 'status', 'warm']);
  if (!commands.has(command)) {
    usage();
    process.exit(1);
  }

  const context = serviceContext();

  switch (command) {
    case 'up':
      await up(context);
      break;
    case 'stop':
      await stop(context);
      break;
    case 'status':
      await status(context);
      break;
    case 'warm':
      await preloadModel(context);
      break;
  }
}

function serviceContext(env = process.env, cwd = process.cwd()) {
  const rootPath = resolve(env.CONDUCTOR_ROOT_PATH || cwd);
  const stateDir = resolve(rootPath, '.context/shared-ollama');
  const baseUrl = env.SHIPFOX_OLLAMA_BASE_URL || env.OLLAMA_BASE_URL || defaultBaseUrl;
  const model = env.SHIPFOX_OLLAMA_MODEL || defaultModel;
  return {
    rootPath,
    stateDir,
    pidFile: resolve(stateDir, 'ollama.pid'),
    logFile: resolve(stateDir, 'ollama.log'),
    baseUrl,
    listenHost: ollamaListenHost(baseUrl),
    model,
    keepAlive: env.SHIPFOX_OLLAMA_KEEP_ALIVE || defaultKeepAlive,
  };
}

async function up(context) {
  mkdirSync(context.stateDir, {recursive: true});

  if (!(await isHealthy(context.baseUrl))) {
    removeStalePid(context.pidFile);
    startServer(context);
    await waitForHealthy(context.baseUrl);
  }

  runRootMise(context, ['exec', '--', 'ollama', 'pull', context.model]);
  startWarmup(context);

  printLine(`Shared Ollama is ready at ${context.baseUrl}.`);
  printLine(`Model: ${context.model}`);
  printLine(`Root: ${context.rootPath}`);
  printLine(`Log: ${context.logFile}`);
}

async function stop(context) {
  const pid = readPid(context.pidFile);
  if (pid === undefined || !isProcessAlive(pid)) {
    rmSync(context.pidFile, {force: true});
    printLine('Shared Ollama is not managed by this repo, or it is already stopped.');
    return;
  }

  killProcessGroup(pid, 'SIGTERM');
  await waitForProcessExit(pid, 5_000);
  if (isProcessAlive(pid)) killProcessGroup(pid, 'SIGKILL');
  rmSync(context.pidFile, {force: true});
  printLine('Shared Ollama stopped.');
}

async function status(context) {
  const healthy = await isHealthy(context.baseUrl);
  const pid = readPid(context.pidFile);
  const managed = pid !== undefined && isProcessAlive(pid);

  printLine(`Root: ${context.rootPath}`);
  printLine(`Endpoint: ${context.baseUrl}`);
  printLine(`Managed process: ${managed ? `running (${pid})` : 'not running'}`);
  printLine(`HTTP health: ${healthy ? 'healthy' : 'unavailable'}`);
}

function startServer(context) {
  const log = openSync(context.logFile, 'a');
  const child = spawn(
    'mise',
    ['-C', context.rootPath, 'exec', '--', 'ollama', 'serve'],
    {
      cwd: context.rootPath,
      detached: true,
      env: {
        ...process.env,
        OLLAMA_HOST: context.listenHost,
      },
      stdio: ['ignore', log, log],
    },
  );
  child.unref();
  writeFileSync(context.pidFile, `${child.pid}\n`);
}

function startWarmup(context) {
  const log = openSync(context.logFile, 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'warm'], {
    cwd: context.rootPath,
    detached: true,
    env: {
      ...process.env,
      CONDUCTOR_ROOT_PATH: context.rootPath,
      SHIPFOX_OLLAMA_BASE_URL: context.baseUrl,
      SHIPFOX_OLLAMA_KEEP_ALIVE: context.keepAlive,
      SHIPFOX_OLLAMA_MODEL: context.model,
    },
    stdio: ['ignore', log, log],
  });
  child.unref();
}

function runRootMise(context, args) {
  const result = spawnSync('mise', ['-C', context.rootPath, ...args], {
    cwd: context.rootPath,
    env: {
      ...process.env,
      OLLAMA_HOST: context.listenHost,
    },
    stdio: 'inherit',
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function preloadModel(context) {
  const response = await fetch(`${context.baseUrl}/api/generate`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      model: context.model,
      prompt: '',
      stream: false,
      keep_alive: context.keepAlive,
    }),
  });
  if (!response.ok) {
    fail(`Failed to preload ${context.model}: ${response.status} ${response.statusText}`);
  }
}

async function waitForHealthy(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (await isHealthy(baseUrl)) return;
    await sleep(pollIntervalMs);
  }
  fail(`Ollama did not become healthy at ${baseUrl} within ${startupTimeoutMs}ms.`);
}

async function isHealthy(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {signal: AbortSignal.timeout(1_000)});
    return response.ok;
  } catch {
    return false;
  }
}

function ollamaListenHost(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

function removeStalePid(pidFile) {
  const pid = readPid(pidFile);
  if (pid !== undefined && isProcessAlive(pid)) return;
  rmSync(pidFile, {force: true});
}

function readPid(pidFile) {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) return;
    await sleep(100);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usage() {
  printError('Usage: node dev/shared-ollama.mjs <up|stop|status>');
}

function fail(message) {
  printError(message);
  process.exit(1);
}

function isCliEntryPoint() {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

function printLine(message) {
  process.stdout.write(`${message}\n`);
}

function printError(message) {
  process.stderr.write(`${message}\n`);
}

export {ollamaListenHost, serviceContext};
