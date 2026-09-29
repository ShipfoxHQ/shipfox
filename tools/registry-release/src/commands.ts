import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {parseRegistryReference} from '@shipfox/registry-format';
import {type BuiltPackage, buildPackage, summarize, writeBuildOutput} from './build.js';
import {readPendingChangesets} from './changesets.js';
import {runCheck} from './check.js';
import {type ConfiguredPackage, discoverPackages, loadConfig} from './config.js';
import {requestGithubOidcToken} from './oidc.js';
import {publishPackages, ReleaseCheckFailedError} from './publish.js';
import {createRegistryClient, type RegistryClient, trimTrailingSlashes} from './registry-client.js';
import {verifyVersion} from './verify.js';

const USAGE = `Usage: shipfox-registry-release <command> [options]

  build <dir>                 Build one package into .shipfox-registry/
  check --mode pr|release     Check every configured package against the registry
  publish                     Check, then publish new versions with a GitHub OIDC token
  verify <ns/name@version>    Rebuild a published version from its provenance commit

Options:
  --config <path>             Config file (default: registry.config.yaml next to the tool)
  --registry <url>            Registry API URL (default: the config file)
`;

export interface CliEnvironment {
  cwd: string;
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  fetch?: typeof globalThis.fetch | undefined;
}

const toolDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Context {
  environment: CliEnvironment;
  root: string;
  registryUrl: string;
  registry: RegistryClient;
  toolVersion: string;
  configured: ConfiguredPackage[];
}

interface CommandInput {
  argument: string | undefined;
  mode: string | undefined;
}

/** Runs one command and returns the process exit code. */
export async function run(argv: string[], environment: CliEnvironment): Promise<number> {
  const {positionals, values} = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: {type: 'string'},
      registry: {type: 'string'},
      mode: {type: 'string'},
      help: {type: 'boolean', short: 'h'},
    },
  });
  const [command, argument] = positionals;
  if (command === undefined || values.help) {
    environment.stdout(USAGE);
    return command === undefined && !values.help ? 1 : 0;
  }

  const context = await loadContext({
    environment,
    config: values.config,
    registry: values.registry,
  });
  const input = {argument, mode: values.mode};
  switch (command) {
    case 'build':
      return await build(context, input);
    case 'check':
      return await check(context, input);
    case 'publish':
      return await publish(context);
    case 'verify':
      return await verify(context, input);
    default:
      environment.stderr(`Unknown command ${command}\n\n${USAGE}`);
      return 1;
  }
}

async function loadContext({
  environment,
  config: configOption,
  registry: registryOption,
}: {
  environment: CliEnvironment;
  config: string | undefined;
  registry: string | undefined;
}): Promise<Context> {
  const configPath = resolve(
    environment.cwd,
    configOption ?? join(toolDirectory, 'registry.config.yaml'),
  );
  const config = await loadConfig(configPath);
  // The config file sits at <root>/tools/registry-release/, and the package globs start at <root>.
  const root = resolve(dirname(configPath), '..', '..');
  const registryUrl = trimTrailingSlashes(registryOption ?? config.registry);
  const packageJson = JSON.parse(await readFile(join(toolDirectory, 'package.json'), 'utf8'));
  return {
    environment,
    root,
    registryUrl,
    registry: createRegistryClient({url: registryUrl, fetch: environment.fetch}),
    toolVersion: packageJson.version,
    configured: await discoverPackages({root, config}),
  };
}

function buildAll({configured, toolVersion}: Context): Promise<BuiltPackage[]> {
  return Promise.all(configured.map((entry) => buildPackage({configured: entry, toolVersion})));
}

async function build(context: Context, {argument}: CommandInput): Promise<number> {
  if (argument === undefined) throw new Error('build needs a package directory');
  const entry = findConfigured({
    configured: context.configured,
    directory: resolve(context.environment.cwd, argument),
  });
  const built = await buildPackage({configured: entry, toolVersion: context.toolVersion});
  const output = await writeBuildOutput({root: context.root, built});
  context.environment.stdout(`${JSON.stringify(summarize(built), null, 2)}\nWrote ${output}\n`);
  return 0;
}

async function check(context: Context, {mode}: CommandInput): Promise<number> {
  if (mode !== 'pr' && mode !== 'release')
    throw new Error('check needs --mode pr or --mode release');
  const result = await runCheck({
    mode,
    packages: await buildAll(context),
    registry: context.registry,
    changesets: await readPendingChangesets(join(context.root, '.changeset')),
  });
  for (const {level, package: name, message} of result.findings) {
    context.environment.stdout(`${level}: ${name}: ${message}\n`);
  }
  context.environment.stdout(result.ok ? 'Registry check passed.\n' : 'Registry check failed.\n');
  return result.ok ? 0 : 1;
}

async function publish(context: Context): Promise<number> {
  const {environment, registryUrl} = context;
  try {
    await publishPackages({
      packages: await buildAll(context),
      registry: context.registry,
      // The registry requires its own public URL as the OIDC audience.
      requestOidcToken: () =>
        requestGithubOidcToken({
          audience: registryUrl,
          env: environment.env,
          fetch: environment.fetch,
        }),
      log: (line) => environment.stdout(`${line}\n`),
    });
  } catch (error) {
    if (!(error instanceof ReleaseCheckFailedError)) throw error;
    environment.stderr(`${error.message}\n`);
    return 1;
  }
  return 0;
}

async function verify(context: Context, {argument}: CommandInput): Promise<number> {
  const reference = argument === undefined ? undefined : parseRegistryReference(argument);
  if (reference === undefined) {
    throw new Error('verify needs ns/name@version, such as shipfox/x@1.0.0');
  }
  const {environment, registry, root, toolVersion} = context;
  const result = await verifyVersion({reference, registry, root, toolVersion});
  for (const mismatch of result.mismatches) environment.stdout(`mismatch: ${mismatch}\n`);
  environment.stdout(result.ok ? 'Digests match.\n' : 'Digests differ.\n');
  return result.ok ? 0 : 1;
}

function findConfigured({
  configured,
  directory,
}: {
  configured: readonly ConfiguredPackage[];
  directory: string;
}): ConfiguredPackage {
  const entry = configured.find((candidate) => candidate.directory === directory);
  if (entry === undefined) {
    throw new Error(`${directory} is not a package in registry.config.yaml`);
  }
  return entry;
}
