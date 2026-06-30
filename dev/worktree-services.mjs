#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const stateDir = resolve('.context/local-services');
const portsFile = resolve(stateDir, 'ports.env');
const composeEnvFile = resolve(stateDir, 'compose.env');
const appEnvFile = resolve(stateDir, 'env');
const composeProjectNameInvalidChars = /[^a-z0-9_-]+/g;
const composeProjectNameLeadingDashes = /^-+/;

if (isCliEntryPoint()) {
  main(process.argv[2]);
}

export function main(command) {
  const commands = new Set(['up', 'stop', 'destroy', 'status']);
  if (!commands.has(command)) {
    usage();
    process.exit(1);
  }

  const workspaceName = requireConductorWorkspace();
  const projectName = resolveProjectName(workspaceName);

  switch (command) {
    case 'up':
      up(workspaceName, projectName);
      break;
    case 'stop':
      stop(projectName);
      break;
    case 'destroy':
      destroy(projectName);
      break;
    case 'status':
      status(projectName);
      break;
  }
}

function up(workspaceName, projectName) {
  mkdirSync(stateDir, {recursive: true});

  const existing = readEnvFile(portsFile);
  const ports =
    Object.keys(existing).length > 0 ? portsFromEnv(existing) : portsFromBase(requireBasePort());

  writeEnvFile(portsFile, {
    SHIPFOX_WORKTREE_SERVICES_WORKSPACE: workspaceName,
    SHIPFOX_WORKTREE_SERVICES_PROJECT: projectName,
    SHIPFOX_PORT_BASE: String(ports.base),
    ...portEnv(ports),
  });
  writeEnvFile(composeEnvFile, composeEnv(ports));
  writeAppEnvFile(appEnvFile, appEnv(ports));

  runDockerCompose(projectName, ['up', '-d', '--wait', 'postgres', 'temporal', 'garage', 'gitea']);
  runDockerCompose(projectName, ['run', '--rm', 'garage-init']);
  runDockerCompose(projectName, ['run', '--rm', 'gitea-init']);

  printLine(`Worktree services are ready for ${workspaceName}.`);
  printLine(`Docker Compose project: ${projectName}`);
  printLine(`Mise environment: ${relativePath(appEnvFile)}`);
}

function stop(projectName) {
  requireComposeState();
  runDockerCompose(projectName, ['down', '--remove-orphans']);
}

function destroy(projectName) {
  if (!existsSync(composeEnvFile)) {
    rmSync(stateDir, {recursive: true, force: true});
    return;
  }
  runDockerCompose(projectName, ['down', '-v', '--remove-orphans']);
  rmSync(stateDir, {recursive: true, force: true});
}

function status(projectName) {
  requireComposeState();
  runDockerCompose(projectName, ['ps']);
}

function requireConductorWorkspace() {
  const name = process.env.CONDUCTOR_WORKSPACE_NAME;
  if (!name) {
    fail('This script must run from a Conductor workspace. CONDUCTOR_WORKSPACE_NAME is not set.');
  }
  return name;
}

function requireBasePort() {
  const raw = process.env.CONDUCTOR_PORT;
  const port = parseBasePort(raw);
  if (port === undefined) {
    fail('CONDUCTOR_PORT must be set to a valid base port for worktree services.');
  }
  return port;
}

function requireComposeState() {
  if (!existsSync(composeEnvFile)) {
    fail(`Missing ${relativePath(composeEnvFile)}. Run "worktree-services.mjs up" first.`);
  }
}

export function portsFromBase(base) {
  return {
    base,
    client: base,
    api: base + 1,
    postgres: base + 2,
    temporal: base + 3,
    temporalUi: base + 4,
    garageS3: base + 5,
    giteaHttp: base + 6,
    giteaSsh: base + 7,
    otelInstance: base + 8,
    otelService: base + 9,
  };
}

function portsFromEnv(env) {
  const base = numberFromEnv(env, 'SHIPFOX_PORT_BASE');
  const ports = {
    base,
    client: numberFromEnv(env, 'SHIPFOX_CLIENT_PORT'),
    api: numberFromEnv(env, 'SHIPFOX_API_PORT'),
    postgres: numberFromEnv(env, 'SHIPFOX_POSTGRES_PORT'),
    temporal: numberFromEnv(env, 'SHIPFOX_TEMPORAL_PORT'),
    temporalUi: numberFromEnv(env, 'SHIPFOX_TEMPORAL_UI_PORT'),
    garageS3: numberFromEnv(env, 'SHIPFOX_GARAGE_S3_PORT'),
    giteaHttp: numberFromEnv(env, 'SHIPFOX_GITEA_HTTP_PORT'),
    giteaSsh: numberFromEnv(env, 'SHIPFOX_GITEA_SSH_PORT'),
    otelInstance: numberFromEnv(env, 'SHIPFOX_OTEL_INSTANCE_METRICS_PORT'),
    otelService: numberFromEnv(env, 'SHIPFOX_OTEL_SERVICE_METRICS_PORT'),
  };
  return ports;
}

function numberFromEnv(env, key) {
  const port = parsePort(env[key]);
  if (port === undefined) {
    fail(`${portsFile} contains an invalid ${key}: ${env[key] ?? '<missing>'}`);
  }
  return port;
}

function portEnv(ports) {
  return {
    SHIPFOX_CLIENT_PORT: String(ports.client),
    SHIPFOX_API_PORT: String(ports.api),
    SHIPFOX_POSTGRES_PORT: String(ports.postgres),
    SHIPFOX_TEMPORAL_PORT: String(ports.temporal),
    SHIPFOX_TEMPORAL_UI_PORT: String(ports.temporalUi),
    SHIPFOX_GARAGE_S3_PORT: String(ports.garageS3),
    SHIPFOX_GITEA_HTTP_PORT: String(ports.giteaHttp),
    SHIPFOX_GITEA_SSH_PORT: String(ports.giteaSsh),
    SHIPFOX_OTEL_INSTANCE_METRICS_PORT: String(ports.otelInstance),
    SHIPFOX_OTEL_SERVICE_METRICS_PORT: String(ports.otelService),
  };
}

function composeEnv(ports) {
  return {
    ...portEnv(ports),
    SHIPFOX_GARAGE_RPC_PORT: '',
    SHIPFOX_GARAGE_ADMIN_PORT: '',
  };
}

function appEnv(ports) {
  const apiUrl = `http://localhost:${ports.api}`;
  const clientUrl = `http://localhost:${ports.client}`;
  return {
    API_PORT: String(ports.api),
    CLIENT_BASE_URL: clientUrl,
    POSTGRES_HOST: 'localhost',
    POSTGRES_PORT: String(ports.postgres),
    POSTGRES_USERNAME: 'shipfox',
    POSTGRES_PASSWORD: 'password',
    POSTGRES_DATABASE: 'api',
    TEMPORAL_ADDRESS: `localhost:${ports.temporal}`,
    GITEA_BASE_URL: `http://localhost:${ports.giteaHttp}`,
    LOG_STORAGE_S3_ENDPOINT: `http://localhost:${ports.garageS3}`,
    OTEL_INSTANCE_METRICS_PORT: String(ports.otelInstance),
    OTEL_SERVICE_METRICS_PORT: String(ports.otelService),
    VITE_API_URL: apiUrl,
    SHIPFOX_CLIENT_PORT: String(ports.client),
    SHIPFOX_API_URL: apiUrl,
    SHIPFOX_RUNNER_API_URL: `http://host.docker.internal:${ports.api}`,
  };
}

function runDockerCompose(projectName, args) {
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', composeEnvFile, '-p', projectName, ...args],
    {stdio: 'inherit'},
  );
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolveProjectName(workspaceName) {
  const existing = readEnvFile(portsFile);
  return existing.SHIPFOX_WORKTREE_SERVICES_PROJECT || composeProjectName(workspaceName);
}

export function composeProjectName(workspaceName) {
  const normalized = workspaceName
    .toLowerCase()
    .replace(composeProjectNameInvalidChars, '-')
    .replace(composeProjectNameLeadingDashes, '');
  const suffix = normalized || 'workspace';
  return `shipfox-${suffix}`.slice(0, 63);
}

function readEnvFile(file) {
  return existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {};
}

export function parseEnvFile(content) {
  const entries = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    entries[key] = value;
  }
  return entries;
}

export function parsePort(raw) {
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

export function parseBasePort(raw) {
  const port = parsePort(raw);
  return port !== undefined && port <= 65_526 ? port : undefined;
}

function writeEnvFile(file, values) {
  const body = `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  writeFileSync(file, body);
}

function writeAppEnvFile(file, values) {
  const body = [
    '# Loaded by mise.toml for commands run in this worktree.',
    '# It is generated by dev/worktree-services.mjs.',
    ...Object.entries(values).map(([key, value]) => `${key}=${dotenvQuote(value)}`),
    '',
  ].join('\n');
  writeFileSync(file, body);
}

function dotenvQuote(value) {
  return JSON.stringify(String(value));
}

function relativePath(file) {
  return file.startsWith(`${process.cwd()}/`) ? file.slice(process.cwd().length + 1) : file;
}

function usage() {
  printError('Usage: node dev/worktree-services.mjs <up|stop|destroy|status>');
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
