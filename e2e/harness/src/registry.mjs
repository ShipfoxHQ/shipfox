import {spawn} from 'node:child_process';
import {generateKeyPairSync} from 'node:crypto';
import {closeSync, openSync} from 'node:fs';
import {mkdir, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

// The registry and the release tool run from their dist, which `mise run e2e:build` produces.
export const registryServerArgs = ['--enable-source-maps', 'apps/registry/dist/index.js'];
const registryImportScript = 'apps/registry/dist/import.js';
const releaseToolScript = 'tools/registry-release/dist/cli.js';
const fixturesConfig = 'e2e/harness/registry.config.yaml';
const fixturesDirectories = ['e2e/harness/registry/actions', 'e2e/harness/registry/templates'];
// `build` writes below <root>/.shipfox-registry/<namespace>, and the fixtures use `fixture`.
const fixturesBuildOutput = '.shipfox-registry/fixture';
const bootstrapPath = 'e2e/harness/registry/bootstrap.yaml';
const registryDatabase = 'registry_e2e';
const signingKeyId = 'e2e';
let generatedSigningKey;

export function e2eRegistryUrl(apiUrl) {
  const endpoint = new URL(apiUrl);
  const apiPort = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  // The last unused ports of the worktree block, after the PostHog mock at API + 16.
  const registryPort = apiPort + 17;
  if (registryPort > 65_535) {
    throw new Error(`Cannot derive a registry port from API port ${apiPort}.`);
  }
  return `http://127.0.0.1:${registryPort}`;
}

/** `REGISTRY_TRUSTED_KEYS` for the API: the public half of this run's signing key. */
export function e2eRegistryTrustedKeys() {
  return JSON.stringify([{keyid: signingKeyId, public_key: signingKey().publicKey}]);
}

/** The environment of the registry server and its import command. */
export function e2eRegistryEnv(env) {
  const url = new URL(env.REGISTRY_URL);
  return {
    ...env,
    PORT: url.port,
    REGISTRY_PUBLIC_URL: env.REGISTRY_URL,
    REGISTRY_STORAGE_URL: pathToFileURL(registryStorageDirectory(url)).toString(),
    REGISTRY_SIGNING_KEY: signingKey().privateKey,
    REGISTRY_SIGNING_KEY_ID: signingKeyId,
    REGISTRY_BOOTSTRAP_PATH: bootstrapPath,
    POSTGRES_DATABASE: registryDatabase,
  };
}

/**
 * Empties the registry's database and blob store, builds the fixture packages with the release
 * tool, and imports them. Each run starts from the same registry content.
 */
export async function seedLocalRegistry({env, logFile}) {
  await resetRegistryDatabase(env);
  await rm(new URL(env.REGISTRY_STORAGE_URL), {recursive: true, force: true});
  await rm(fixturesBuildOutput, {recursive: true, force: true});

  const packageDirectories = (
    await Promise.all(fixturesDirectories.map((directory) => childDirectories(directory)))
  ).flat();
  await Promise.all(
    packageDirectories.map((directory) =>
      runLogged(
        process.execPath,
        [releaseToolScript, 'build', directory, '--config', fixturesConfig],
        {env, logFile},
      ),
    ),
  );
  await runLogged(process.execPath, [registryImportScript, fixturesBuildOutput], {env, logFile});
}

async function resetRegistryDatabase(env) {
  const client = new pg.Client({
    host: env.POSTGRES_HOST ?? 'localhost',
    port: Number(env.POSTGRES_PORT ?? 5432),
    user: env.POSTGRES_USERNAME ?? 'shipfox',
    password: env.POSTGRES_PASSWORD ?? 'password',
    database: 'postgres',
  });
  await client.connect();
  try {
    // FORCE ends the connections of a registry left running by --keep-open.
    await client.query(`DROP DATABASE IF EXISTS ${registryDatabase} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${registryDatabase}`);
  } finally {
    await client.end();
  }
}

function registryStorageDirectory(url) {
  return join(tmpdir(), `shipfox-e2e-registry-${url.port}`);
}

async function childDirectories(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name));
}

async function runLogged(command, args, {env, logFile}) {
  await mkdir(dirname(logFile), {recursive: true});
  const logFd = openSync(logFile, 'a');
  let child;
  try {
    child = spawn(command, args, {env, stdio: ['ignore', logFd, logFd]});
  } finally {
    closeSync(logFd);
  }
  const exitCode = await new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(
      `${args.slice(0, 2).join(' ')} failed with exit code ${exitCode}; see ${logFile}`,
    );
  }
}

function signingKey() {
  if (generatedSigningKey === undefined) {
    const {privateKey, publicKey} = generateKeyPairSync('ed25519', {
      privateKeyEncoding: {format: 'pem', type: 'pkcs8'},
      publicKeyEncoding: {format: 'der', type: 'spki'},
    });
    generatedSigningKey = {privateKey, publicKey: publicKey.toString('base64')};
  }
  return generatedSigningKey;
}
