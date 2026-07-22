#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const composeProjectNameMaxLength = 63;
const composeProjectNamePrefix = 'shipfox-';
const composeFileName = 'compose.yml';
const portLeaseDirectory = resolve(homedir(), '.shipfox');
const portLeasesFile = resolve(portLeaseDirectory, 'shipfox-port-leases.json');
const portRangeStart = 20_000;
const portRangeEnd = 45_999;
const portBlockSize = 20;
const stateDir = resolve('.context/local-services');
const portsFile = resolve(stateDir, 'ports.env');
const composeEnvFile = resolve(stateDir, 'compose.env');
const appEnvFile = resolve(stateDir, 'env');
const composeProjectNameInvalidChars = /[^a-z0-9_-]+/g;
const composeProjectNameLeadingDashes = /^-+/;
const composeProjectNameTrailingDashes = /-+$/;

if (isCliEntryPoint()) {
  main(process.argv.slice(2));
}

export function main(commandOrArgs) {
  const [command, ...commandArgs] = Array.isArray(commandOrArgs) ? commandOrArgs : [commandOrArgs];
  const commands = new Set(['up', 'stop', 'destroy', 'status', 'cleanup']);
  if (!commands.has(command) || (command !== 'cleanup' && commandArgs.length > 0)) {
    usage();
    process.exit(1);
  }

  if (command === 'cleanup') {
    cleanup(commandArgs);
    return;
  }

  const workspaceName = basename(resolve());
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

  const ports = portsFromBase(leasePortBlock());

  writeEnvFile(portsFile, {
    SHIPFOX_WORKTREE_SERVICES_WORKSPACE: workspaceName,
    SHIPFOX_WORKTREE_SERVICES_PROJECT: projectName,
    SHIPFOX_PORT_BASE: String(ports.base),
    ...portEnv(ports),
  });
  writeEnvFile(composeEnvFile, composeEnv(ports));
  writeAppEnvFile(appEnvFile, appEnv(ports));

  const composeFile = resolveComposeFile();

  runDockerCompose(projectName, ['up', '-d', '--wait', 'postgres', 'temporal', 'garage', 'gitea'], {
    composeFile,
  });
  runDockerCompose(projectName, ['run', '--rm', 'garage-init'], {composeFile});
  runDockerCompose(projectName, ['run', '--rm', 'gitea-init'], {composeFile});

  printLine(`Worktree services are ready for ${workspaceName}.`);
  printLine(`Docker Compose project: ${projectName}`);
  printLine(`Mise environment: ${relativePath(appEnvFile)}`);
}

function stop(projectName) {
  requireComposeState();
  runDockerCompose(projectName, ['down', '--remove-orphans'], {
    composeFile: resolveComposeFile({allowRootFallback: true}),
  });
}

function destroy(projectName) {
  if (!existsSync(composeEnvFile)) {
    rmSync(stateDir, {recursive: true, force: true});
    releasePortLease(resolve());
    return;
  }
  runDockerCompose(projectName, ['down', '-v', '--remove-orphans'], {
    composeFile: resolveComposeFile({allowRootFallback: true}),
  });
  rmSync(stateDir, {recursive: true, force: true});
  releasePortLease(resolve());
}

function status(projectName) {
  requireComposeState();
  runDockerCompose(projectName, ['ps'], {
    composeFile: resolveComposeFile({allowRootFallback: true}),
  });
}

function requireComposeState() {
  if (!existsSync(composeEnvFile)) {
    fail(`Missing ${relativePath(composeEnvFile)}. Run "worktree-services.mjs up" first.`);
  }
}

function cleanup(args) {
  if (args.length > 1 || (args[0] !== undefined && args[0] !== '--apply')) {
    usage();
    process.exit(1);
  }

  const staleLeases = findStalePortLeases();
  if (staleLeases.length === 0) {
    printLine('No stale Shipfox port leases found.');
    return;
  }

  for (const lease of staleLeases) {
    printLine(`${lease.workspacePath} (${lease.base}-${lease.base + portBlockSize - 1})`);
  }

  if (args[0] === '--apply') {
    removeStalePortLeases(staleLeases);
    printLine(`Removed ${staleLeases.length} stale Shipfox port lease(s).`);
    return;
  }

  printLine(
    `Found ${staleLeases.length} stale Shipfox port lease(s). Run cleanup --apply to remove them.`,
  );
}

export function leasePortBlock({workspacePath = resolve(), registryFile = portLeasesFile} = {}) {
  const resolvedWorkspacePath = resolve(workspacePath);
  return withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    const existingLease = registry.leases[resolvedWorkspacePath];
    if (existingLease) return existingLease.base;

    const base = nextAvailablePortBlock(registry);
    registry.leases[resolvedWorkspacePath] = {base, allocatedAt: new Date().toISOString()};
    registry.nextBase = nextPortBlock(base);
    writePortLeaseRegistry(registry, registryFile);
    return base;
  }, registryFile);
}

export function findStalePortLeases({registryFile = portLeasesFile} = {}) {
  return withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    return Object.entries(registry.leases)
      .filter(([workspacePath]) => !existsSync(workspacePath))
      .map(([workspacePath, lease]) => ({workspacePath, ...lease}));
  }, registryFile);
}

export function removeStalePortLeases(staleLeases, {registryFile = portLeasesFile} = {}) {
  withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    for (const {workspacePath} of staleLeases) {
      if (!existsSync(workspacePath)) delete registry.leases[workspacePath];
    }
    writePortLeaseRegistry(registry, registryFile);
  }, registryFile);
}

function releasePortLease(workspacePath, registryFile = portLeasesFile) {
  withPortLeaseLock(() => {
    const registry = readPortLeaseRegistry(registryFile);
    delete registry.leases[resolve(workspacePath)];
    writePortLeaseRegistry(registry, registryFile);
  }, registryFile);
}

function withPortLeaseLock(callback, registryFile) {
  const lockDirectory = resolve(dirname(registryFile), 'shipfox-port-leases.lock');
  mkdirSync(dirname(registryFile), {recursive: true});
  try {
    mkdirSync(lockDirectory);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail(
        `Shipfox port lease registry is in use. Retry after the other workspace setup completes.`,
      );
    }
    throw error;
  }

  try {
    return callback();
  } finally {
    rmdirSync(lockDirectory);
  }
}

function readPortLeaseRegistry(registryFile) {
  if (!existsSync(registryFile)) {
    return {
      version: 1,
      range: {start: portRangeStart, end: portRangeEnd, blockSize: portBlockSize},
      nextBase: portRangeStart,
      leases: {},
    };
  }

  const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
  if (
    registry.version !== 1 ||
    registry.range?.start !== portRangeStart ||
    registry.range?.end !== portRangeEnd ||
    registry.range?.blockSize !== portBlockSize ||
    !Number.isInteger(registry.nextBase) ||
    !registry.leases ||
    typeof registry.leases !== 'object'
  ) {
    fail(`Invalid Shipfox port lease registry: ${registryFile}`);
  }
  return registry;
}

function writePortLeaseRegistry(registry, registryFile) {
  writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
}

function nextAvailablePortBlock(registry) {
  const leasedBases = new Set(Object.values(registry.leases).map((lease) => lease.base));
  let candidate = registry.nextBase;
  const capacity = (portRangeEnd - portRangeStart + 1) / portBlockSize;

  for (let attempt = 0; attempt < capacity; attempt += 1) {
    if (!leasedBases.has(candidate)) return candidate;
    candidate = nextPortBlock(candidate);
  }

  fail('Shipfox port lease range is exhausted. Run cleanup to remove stale leases.');
}

function nextPortBlock(base) {
  const nextBase = base + portBlockSize;
  return nextBase + portBlockSize - 1 <= portRangeEnd ? nextBase : portRangeStart;
}

export function portsFromBase(base) {
  return {
    base,
    client: base,
    api: base + 1,
    postgres: base + 2,
    temporal: base + 3,
    docs: base + 4,
    garageS3: base + 5,
    giteaHttp: base + 6,
    giteaSsh: base + 7,
    otelInstance: base + 8,
    otelService: base + 9,
    linearMcp: base + 10,
    githubApi: base + 11,
    slackApi: base + 12,
    otelTemporal: base + 13,
  };
}

function portEnv(ports) {
  return {
    SHIPFOX_CLIENT_PORT: String(ports.client),
    SHIPFOX_API_PORT: String(ports.api),
    SHIPFOX_POSTGRES_PORT: String(ports.postgres),
    SHIPFOX_TEMPORAL_PORT: String(ports.temporal),
    SHIPFOX_DOCS_PORT: String(ports.docs),
    SHIPFOX_GARAGE_S3_PORT: String(ports.garageS3),
    SHIPFOX_GITEA_HTTP_PORT: String(ports.giteaHttp),
    SHIPFOX_GITEA_SSH_PORT: String(ports.giteaSsh),
    SHIPFOX_OTEL_INSTANCE_METRICS_PORT: String(ports.otelInstance),
    SHIPFOX_OTEL_SERVICE_METRICS_PORT: String(ports.otelService),
    SHIPFOX_OTEL_TEMPORAL_METRICS_PORT: String(ports.otelTemporal),
    SHIPFOX_LINEAR_MCP_PORT: String(ports.linearMcp),
    SHIPFOX_GITHUB_API_PORT: String(ports.githubApi),
    SHIPFOX_SLACK_API_PORT: String(ports.slackApi),
  };
}

function composeEnv(ports) {
  return {
    ...portEnv(ports),
    SHIPFOX_TEMPORAL_UI_PORT: '',
    SHIPFOX_GARAGE_RPC_PORT: '',
    SHIPFOX_GARAGE_ADMIN_PORT: '',
  };
}

export function appEnv(ports) {
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
    GITHUB_API_BASE_URL: `http://127.0.0.1:${ports.githubApi}`,
    LOG_STORAGE_S3_ENDPOINT: `http://localhost:${ports.garageS3}`,
    LINEAR_MCP_ENDPOINT: `http://127.0.0.1:${ports.linearMcp}/mcp`,
    SLACK_API_BASE_URL: `http://127.0.0.1:${ports.slackApi}`,
    OTEL_INSTANCE_METRICS_PORT: String(ports.otelInstance),
    OTEL_SERVICE_METRICS_PORT: String(ports.otelService),
    OTEL_TEMPORAL_METRICS_PORT: String(ports.otelTemporal),
    VITE_API_URL: apiUrl,
    SHIPFOX_CLIENT_PORT: String(ports.client),
    SHIPFOX_DOCS_PORT: String(ports.docs),
    SHIPFOX_API_URL: apiUrl,
    SHIPFOX_RUNNER_API_URL: `http://host.docker.internal:${ports.api}`,
    SHIPFOX_PROVISIONER_DOCKER_EXTRA_HOSTS: 'host.docker.internal:host-gateway',
  };
}

function runDockerCompose(projectName, args, {composeFile = resolveComposeFile()} = {}) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      composeEnvFile,
      '-f',
      composeFile,
      '--project-directory',
      dirname(composeFile),
      '-p',
      projectName,
      ...args,
    ],
    {stdio: 'inherit'},
  );
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function resolveComposeFile({
  workspacePath = process.cwd(),
  rootPath = process.env.CONDUCTOR_ROOT_PATH,
  allowRootFallback = false,
} = {}) {
  const workspaceComposeFile = resolve(workspacePath, composeFileName);
  if (existsSync(workspaceComposeFile)) return workspaceComposeFile;

  if (allowRootFallback && rootPath) {
    const rootComposeFile = resolve(rootPath, composeFileName);
    if (existsSync(rootComposeFile)) return rootComposeFile;
  }

  fail(`Missing ${relativePath(workspaceComposeFile)}.`);
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
  const hash = createHash('sha256').update(workspaceName).digest('hex').slice(0, 8);
  const suffixLength =
    composeProjectNameMaxLength - composeProjectNamePrefix.length - hash.length - 1;
  const suffix =
    (normalized || 'workspace')
      .slice(0, suffixLength)
      .replace(composeProjectNameTrailingDashes, '') || 'workspace';
  return `${composeProjectNamePrefix}${suffix}-${hash}`;
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
  printError('Usage: node dev/worktree-services.mjs <up|stop|destroy|status|cleanup [--apply]>');
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
