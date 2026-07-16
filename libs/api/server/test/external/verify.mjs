import {spawn} from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import {createServer as createNetServer} from 'node:net';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  computePublicationClosure,
  readPublicationClosureConfig,
  readWorkspacePackages,
  validatePublicationState,
} from '@shipfox/application-release/package-closure';

const DATABASE_NAME = 'shipfox_api_server_external';
const REGISTRY_SHIPFOX_PACKAGE_PATTERN = /^@shipfox\+[^@]+@\d/u;
const repositoryRoot = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const config = readPublicationClosureConfig(resolve(repositoryRoot, 'publication-closure.json'));
const workspacePackages = readWorkspacePackages(repositoryRoot);
validatePublicationState(workspacePackages, config, repositoryRoot);
const closure = computePublicationClosure(workspacePackages, ['@shipfox/api-server']);
await emitDeclarationFiles(closure);

const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-api-server-external-'));
const tarballRoot = join(fixtureRoot, 'tarballs');

try {
  await mkdir(tarballRoot);
  const tarballs = await mapWithConcurrency(closure, 4, async (name) => {
    const workspacePackage = workspacePackages.get(name);
    if (!workspacePackage) throw new Error(`Missing workspace package: ${name}`);
    const tarball = join(tarballRoot, `${safePackageName(name)}.tgz`);
    await run('pnpm', ['pack', '--out', tarball], workspacePackage.directory);
    return [name, tarball];
  });

  const dependencies = Object.fromEntries(
    tarballs.map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  await writeFixtureFiles(fixtureRoot, dependencies);
  await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot);
  await validateInstalledPackages(fixtureRoot, closure, workspacePackages);
  await validateNoRegistryShipfoxPackages(fixtureRoot);

  const [apiPort, instanceMetricsPort, serviceMetricsPort] = await Promise.all([
    getAvailablePort(),
    getAvailablePort(),
    getAvailablePort(),
  ]);
  const environment = runtimeEnvironment({apiPort, instanceMetricsPort, serviceMetricsPort});
  await run(process.execPath, ['create-db.mjs'], fixtureRoot, {
    ...environment,
    POSTGRES_DATABASE: 'postgres',
  });
  await run(
    process.execPath,
    ['--import', '@shipfox/api-server/instrumentation', 'server.mjs'],
    fixtureRoot,
    environment,
  );
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}

async function writeFixtureFiles(root, dependencies) {
  await Promise.all([
    writeFile(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'shipfox-api-server-external-consumer',
          version: '1.0.0',
          private: true,
          type: 'module',
          dependencies,
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(root, 'pnpm-workspace.yaml'),
      `packages:\n  - .\noverrides:\n${Object.entries(dependencies)
        .map(([name, tarball]) => `  ${JSON.stringify(name)}: ${JSON.stringify(tarball)}`)
        .join('\n')}\n`,
    ),
    copyFile(new URL('./create-db.mjs', import.meta.url), join(root, 'create-db.mjs')),
    copyFile(new URL('./server.mjs', import.meta.url), join(root, 'server.mjs')),
  ]);
}

async function validateInstalledPackages(root, names, workspacePackages) {
  const realFixtureRoot = await realpath(root);
  for (const name of names) {
    const installedManifestPath = join(root, 'node_modules', name, 'package.json');
    const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'));
    const expectedManifest = workspacePackages.get(name)?.manifest;
    if (!expectedManifest) throw new Error(`Missing workspace package: ${name}`);
    if (installedManifest.version !== expectedManifest.version) {
      throw new Error(
        `Packed ${name} has version ${installedManifest.version}; expected ${expectedManifest.version}`,
      );
    }
    if (installedManifest.private === true) throw new Error(`Packed ${name} is private`);
    const workspaceRange = findWorkspaceRange(installedManifest);
    if (workspaceRange) {
      throw new Error(`Packed ${name} contains a workspace range at ${workspaceRange}`);
    }
    const installedRoot = await realpath(join(root, 'node_modules', name));
    if (!installedRoot.startsWith(realFixtureRoot)) {
      throw new Error(`Packed ${name} resolved outside the external consumer`);
    }
  }
}

async function validateNoRegistryShipfoxPackages(root) {
  const virtualStore = await readdir(join(root, 'node_modules/.pnpm'), {withFileTypes: true});
  const registryPackages = virtualStore
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => REGISTRY_SHIPFOX_PACKAGE_PATTERN.test(name));
  if (registryPackages.length) {
    throw new Error(
      `External consumer used registry Shipfox packages: ${registryPackages.join(', ')}`,
    );
  }
}

function findWorkspaceRange(value, path = 'package.json') {
  if (typeof value === 'string') return value.startsWith('workspace:') ? path : undefined;
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, child] of Object.entries(value)) {
    const found = findWorkspaceRange(child, `${path}.${key}`);
    if (found) return found;
  }
  return undefined;
}

function runtimeEnvironment({apiPort, instanceMetricsPort, serviceMetricsPort}) {
  const postgresHost = environmentValue('POSTGRES_HOST', '127.0.0.1');
  const postgresPort = environmentValue('POSTGRES_PORT', '5432');
  const postgresUsername = environmentValue('POSTGRES_USERNAME', 'shipfox');
  const postgresPassword = environmentValue('POSTGRES_PASSWORD', 'password');

  return {
    API_PORT: String(apiPort),
    API_TRUST_PROXY: 'false',
    AUTH_JOB_LEASE_TOKEN_SECRET: 'external-consumer-lease-secret',
    AUTH_JWT_SECRET: 'external-consumer-jwt-secret',
    AUTH_RUNNER_SESSION_TOKEN_SECRET: 'external-consumer-runner-secret',
    DATABASE_URL: `postgres://${postgresUsername}:${postgresPassword}@${postgresHost}:${postgresPort}/${DATABASE_NAME}`,
    GITEA_BASE_URL: environmentValue('GITEA_BASE_URL', 'https://gitea.example.com'),
    GITEA_SERVICE_TOKEN: 'external-consumer-token',
    GITEA_SERVICE_USERNAME: 'shipfox-bot',
    GITEA_WEBHOOK_SECRET: 'external-consumer-webhook-secret',
    GITHUB_API_BASE_URL: environmentValue('GITHUB_API_BASE_URL', 'https://api.github.com'),
    GITHUB_APP_CLIENT_ID: 'external-consumer-client-id',
    GITHUB_APP_CLIENT_SECRET: 'external-consumer-client-secret',
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'external-consumer-private-key',
    GITHUB_APP_SLUG: 'shipfox-external-consumer',
    GITHUB_APP_USERNAME: 'shipfox-external-consumer',
    GITHUB_APP_WEBHOOK_SECRET: 'external-consumer-webhook-secret',
    GITHUB_INSTALL_STATE_SECRET: 'external-consumer-install-state-secret',
    HOST: '127.0.0.1',
    LINEAR_MCP_ENDPOINT: environmentValue('LINEAR_MCP_ENDPOINT', 'https://mcp.linear.app/mcp'),
    LINEAR_OAUTH_CLIENT_ID: 'external-consumer-client-id',
    LINEAR_OAUTH_CLIENT_SECRET: 'external-consumer-client-secret',
    LINEAR_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/linear/callback',
    LINEAR_WEBHOOK_SIGNING_SECRET: 'external-consumer-webhook-secret',
    LOG_STORAGE_S3_ACCESS_KEY_ID: 'external-consumer-access-key',
    LOG_STORAGE_S3_BUCKET: 'shipfox-logs',
    LOG_STORAGE_S3_ENDPOINT: environmentValue('LOG_STORAGE_S3_ENDPOINT', 'http://127.0.0.1:3900'),
    LOG_STORAGE_S3_FORCE_PATH_STYLE: 'true',
    LOG_STORAGE_S3_REGION: 'garage',
    LOG_STORAGE_S3_SECRET_ACCESS_KEY: 'external-consumer-secret-key',
    OTEL_INSTANCE_METRICS_PORT: String(instanceMetricsPort),
    OTEL_SERVICE_METRICS_PORT: String(serviceMetricsPort),
    POSTGRES_DATABASE: DATABASE_NAME,
    POSTGRES_HOST: postgresHost,
    POSTGRES_MAX_CONNECTIONS: '5',
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_PORT: postgresPort,
    POSTGRES_USERNAME: postgresUsername,
    SECRETS_ENCRYPTION_KEK: 'ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=',
    SENTRY_APP_CLIENT_ID: 'external-consumer-client-id',
    SENTRY_APP_CLIENT_SECRET: 'external-consumer-client-secret',
    SENTRY_APP_SLUG: 'shipfox-external-consumer',
    SENTRY_APP_VERIFY_INSTALL: 'true',
    TEMPORAL_ADDRESS: environmentValue('TEMPORAL_ADDRESS', '127.0.0.1:7233'),
    WORKSPACE_JWT_SECRET: 'external-consumer-workspace-secret',
  };
}

function environmentValue(name, defaultValue) {
  return process.env[name] ?? defaultValue;
}

function safePackageName(name) {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}

async function emitDeclarationFiles(packageNames) {
  await run(
    'pnpm',
    ['exec', 'turbo', 'type:emit', ...packageNames.map((name) => `--filter=${name}`)],
    repositoryRoot,
  );
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({length: concurrency}, () => worker()));
  return results;
}

function getAvailablePort() {
  const server = createNetServer();
  server.unref();

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen({host: '127.0.0.1', port: 0}, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate an external API server port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolvePromise(address.port);
      });
    });
  });
}

function run(command, args, cwd, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {...process.env, ...environment},
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${basename(command)} ${args.join(' ')} exited with code ${code}`));
    });
  });
}
