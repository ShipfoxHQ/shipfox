import {mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapWithConcurrency, packProductionizedPackage, run} from '@shipfox/package-release/packer';
import {parse as parseYaml} from 'yaml';

import {
  computePublicationClosure,
  entryPointSupportsRuntimeImport,
  entryPointSupportsTypeResolution,
  listPublicPackageEntryPoints,
  readPublicationClosureConfig,
  readWorkspacePackages,
  validatePublicationState,
} from '../../dist/package-closure.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const REGISTRY_SHIPFOX_PACKAGE_PATTERN = /^@shipfox\+[^@]+@\d/u;
const config = readPublicationClosureConfig(resolve(repositoryRoot, 'publication-closure.json'));
const workspacePackages = readWorkspacePackages(repositoryRoot);
const dependencyContext = {
  workspaceConfig: parseYaml(await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')),
  workspaceVersions: new Map(
    [...workspacePackages]
      .filter(([, workspacePackage]) => typeof workspacePackage.manifest.version === 'string')
      .map(([name, workspacePackage]) => [name, workspacePackage.manifest.version]),
  ),
};
validatePublicationState(workspacePackages, config, repositoryRoot);
const closure = computePublicationClosure(
  workspacePackages,
  config.roots.filter((root) => !root.startsWith('@shipfox/client-')),
);
const fixtureRoot = await mkdtemp(join(tmpdir(), 'shipfox-api-runtime-'));
const tarballRoot = join(fixtureRoot, 'tarballs');
const stagingRoot = join(fixtureRoot, 'packages');

try {
  await Promise.all([mkdir(tarballRoot), mkdir(stagingRoot)]);
  const tarballs = await mapWithConcurrency(closure, 4, async (name) => {
    const workspacePackage = workspacePackages.get(name);
    if (!workspacePackage) throw new Error(`Missing workspace package: ${name}`);
    const tarball = join(tarballRoot, `${safePackageName(name)}.tgz`);
    await packProductionizedPackage({
      dependencyContext,
      manifest: workspacePackage.manifest,
      sourceDirectory: workspacePackage.directory,
      stagingRoot,
      packArtifact: (stagedDirectory) =>
        run('pnpm', ['pack', '--out', tarball], stagedDirectory, {stdio: 'ignore'}),
    });
    return [name, tarball];
  });

  const dependencies = Object.fromEntries(
    tarballs.map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  const entryPoints = closure.flatMap((name) =>
    listPublicPackageEntryPoints(name, workspacePackages.get(name)?.manifest.exports),
  );
  const runtimeEntryPoints = entryPoints
    .filter(({target}) => entryPointSupportsRuntimeImport(target))
    .map(({specifier}) => specifier);
  const typeEntryPoints = entryPoints
    .filter(({target}) => entryPointSupportsTypeResolution(target))
    .map(({specifier}) => specifier);
  await writeFixtureFiles(fixtureRoot, dependencies, runtimeEntryPoints, typeEntryPoints);
  await run('pnpm', ['install', '--prefer-offline', '--ignore-scripts'], fixtureRoot);
  await validateInstalledPackages(fixtureRoot, closure, workspacePackages);
  await validateNoRegistryShipfoxPackages(fixtureRoot);

  const tsc = resolve(repositoryRoot, 'tools/typescript/node_modules/typescript/bin/tsc');
  await run(process.execPath, [tsc, '--project', 'tsconfig.json'], fixtureRoot);
  await run(process.execPath, ['runtime-imports.mjs'], fixtureRoot);
  await run(process.execPath, ['runners-composition.mjs'], fixtureRoot);
  await run(process.execPath, ['workflow-source-bundle.mjs'], fixtureRoot);
  await run(
    resolve(repositoryRoot, 'tools/application-release/node_modules/.bin/tsx'),
    ['--conditions=development', 'development-conditions.mjs'],
    fixtureRoot,
  );
  await run(process.execPath, ['workflow-bundles.mjs'], fixtureRoot);
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}

async function writeFixtureFiles(root, dependencies, runtimeEntryPoints, typeEntryPoints) {
  await Promise.all([
    writeFile(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'shipfox-api-runtime-external-consumer',
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
    writeFile(
      join(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: 'ES2024',
          },
          include: ['types.ts', 'composition.ts', 'runners-composition.ts'],
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(root, 'types.ts'),
      `${typeEntryPoints
        .map(
          (specifier, index) => `import type * as Entry${index} from ${JSON.stringify(specifier)};`,
        )
        .join(
          '\n',
        )}\n\n${typeEntryPoints.map((_, index) => `void (0 as unknown as typeof Entry${index});`).join('\n')}\n`,
    ),
    writeFile(
      join(root, 'composition.ts'),
      `import {createRunnersModule} from '@shipfox/api-runners';
import {createServer, defaultModules} from '@shipfox/api-server';

void createServer({
  modules: [
    ...(await defaultModules({
      runnersModule: ({auth}) =>
        createRunnersModule({
          auth,
          installationProvisioning: {
            policy: {
              filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),
            },
          },
        }),
    })),
    {name: 'external-dummy'},
  ],
});
`,
    ),
    writeFile(
      join(root, 'runners-composition.ts'),
      `import {createRunnersModule} from '@shipfox/api-runners';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';

const auth = {} as AuthInterModuleClient;
const module = createRunnersModule({
  auth,
  installationProvisioning: {
    policy: {
      filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),
    },
  },
});

void module;
`,
    ),
    writeFile(
      join(root, 'runners-composition.mjs'),
      `Object.assign(process.env, ${JSON.stringify(runtimeEnvironment(), null, 2)});\n\nconst {createRunnersModule} = await import('@shipfox/api-runners');\nconst module = createRunnersModule({\n  auth: {},\n  installationProvisioning: {\n    policy: {\n      filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),\n    },\n  },\n});\nif (module.name !== 'runners' || !module.routes?.length) {\n  throw new Error('Packed API runners does not compose the installation provisioning policy.');\n}\nconsole.log('Composed packed API runners with an external installation policy.');\n`,
    ),
    writeFile(
      join(root, 'runtime-imports.mjs'),
      `Object.assign(process.env, ${JSON.stringify(runtimeEnvironment(), null, 2)});\n\nconst entryPoints = ${JSON.stringify(runtimeEntryPoints, null, 2)};\nfor (const entryPoint of entryPoints) await import(entryPoint);\nconst {createServer, defaultModules} = await import('@shipfox/api-server');\nif (typeof createServer !== 'function' || typeof defaultModules !== 'function')\n  throw new Error('Packed API server does not export its composition API.');\nconst modules = [...(await defaultModules()), {name: 'external-dummy'}];\nif (modules.at(-1)?.name !== 'external-dummy')\n  throw new Error('Could not append an external module to the packed API server defaults.');\nconsole.log(\`Imported \${entryPoints.length} packed runtime entry points and composed API modules.\`);\nprocess.exit(0);\n`,
    ),
    writeFile(
      join(root, 'workflow-bundles.mjs'),
      `Object.assign(process.env, {...${JSON.stringify(runtimeEnvironment(), null, 2)}, INTEGRATIONS_ENABLE_SENTRY_PROVIDER: 'true', NODE_ENV: 'production'});\n\nconst {readdir, readFile} = await import('node:fs/promises');\nconst {dirname, join} = await import('node:path');\nconst {defaultModules} = await import('@shipfox/api-server');\nconst {loadProductionWorkflowBundle} = await import('@shipfox/node-temporal');\nconst modules = await defaultModules();\nconst workflowPaths = new Set(\n  modules.flatMap((module) => module.workers ?? []).map((worker) => worker.workflowsPath),\n);\n\nif (!workflowPaths.size) throw new Error('Packed API server declares no workflow entrypoints.');\n\nconst bundles = new Map();\nfor (const workflowsPath of workflowPaths) {\n  const workflowBundle = loadProductionWorkflowBundle(workflowsPath);\n  bundles.set(workflowsPath, workflowBundle);\n\n  const code = await readFile(workflowBundle.codePath, 'utf8');\n  if (/@shipfox[/\\\\][^/\\\\]+[/\\\\]src[/\\\\]/u.test(code)) {\n    throw new Error(\n      \`Workflow bundle for \${workflowsPath} resolved a first-party source path.\`,\n    );\n  }\n}\n\nconst declaredCodePaths = new Set([...bundles.values()].map(({codePath}) => codePath));\nif (declaredCodePaths.size !== workflowPaths.size) {\n  throw new Error('Packed API workflow entrypoints do not map one-to-one to prebuilt bundles.');\n}\n\nconst workflowDirectories = new Set([...workflowPaths].map((workflowsPath) => dirname(workflowsPath)));\nconst emittedBundles = (\n  await Promise.all(\n    [...workflowDirectories].map(async (directory) =>\n      (await readdir(directory))\n        .filter((entry) => entry.endsWith('.bundle.js'))\n        .map((entry) => join(directory, entry)),\n    ),\n  )\n).flat();\nconst unreferencedBundles = emittedBundles.filter((codePath) => !declaredCodePaths.has(codePath));\nif (unreferencedBundles.length) {\n  throw new Error(\n    \`Packed API contains unreferenced workflow bundles: \${unreferencedBundles.join(', ')}\`,\n  );\n}\n\nconsole.log(\`Validated \${workflowPaths.size} packed API workflow bundles.\`);\n`,
    ),
    writeFile(
      join(root, 'development-conditions.mjs'),
      `Object.assign(process.env, ${JSON.stringify(runtimeEnvironment(), null, 2)});\n\nawait import('@shipfox/api-server/instrumentation');\nprocess.exit(0);\n`,
    ),
    writeFile(
      join(root, 'workflow-source-bundle.mjs'),
      `delete process.env.NODE_ENV;\n\nconst {createRequire} = await import('node:module');\nconst {fileURLToPath} = await import('node:url');\nconst {dirname, join} = await import('node:path');\nconst temporalRequire = createRequire(import.meta.resolve('@shipfox/node-temporal'));\nconst {bundleWorkflowCode} = await import(temporalRequire.resolve('@temporalio/worker'));\nconst packageEntryPoint = fileURLToPath(import.meta.resolve('@shipfox/api-definitions'));\nconst workflowsPath = join(\n  dirname(dirname(packageEntryPoint)),\n  'dist',\n  'temporal',\n  'workflows',\n  'index.js',\n);\n\nawait bundleWorkflowCode({workflowsPath});\nconsole.log('Bundled a packed API definitions workflow with Temporal defaults.');\n`,
    ),
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

function runtimeEnvironment() {
  // Prefer the active workspace's own Postgres connection (e.g. a Conductor
  // worktree's isolated instance) over the fixed port CI's dedicated service
  // listens on, so this fixture never migrates or mutates an unrelated
  // Postgres instance that happens to also be reachable on the CI default.
  const postgresHost = process.env.POSTGRES_HOST ?? '127.0.0.1';
  const postgresPort = process.env.POSTGRES_PORT ?? '5432';
  const postgresUsername = process.env.POSTGRES_USERNAME ?? 'shipfox';
  const postgresPassword = process.env.POSTGRES_PASSWORD ?? 'password';
  const postgresDatabase = 'api_test';

  return {
    AUTH_ROOT_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    DATABASE_URL: `postgres://${postgresUsername}:${postgresPassword}@${postgresHost}:${postgresPort}/${postgresDatabase}`,
    GITEA_BASE_URL: 'https://gitea.example.com',
    GITEA_SERVICE_TOKEN: 'external-consumer-token',
    GITEA_SERVICE_USERNAME: 'shipfox-bot',
    GITEA_WEBHOOK_SECRET: 'external-consumer-webhook-secret',
    GITHUB_API_BASE_URL: 'https://api.github.com',
    GITHUB_APP_CLIENT_ID: 'external-consumer-client-id',
    GITHUB_APP_CLIENT_SECRET: 'external-consumer-client-secret',
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'external-consumer-private-key',
    GITHUB_APP_SLUG: 'shipfox-external-consumer',
    GITHUB_APP_USERNAME: 'shipfox-external-consumer',
    GITHUB_APP_WEBHOOK_SECRET: 'external-consumer-webhook-secret',
    GITHUB_INSTALL_STATE_SECRET: 'external-consumer-install-state-secret',
    JIRA_OAUTH_CLIENT_ID: 'external-consumer-client-id',
    JIRA_OAUTH_CLIENT_SECRET: 'external-consumer-client-secret',
    JIRA_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/jira/callback',
    JIRA_WEBHOOK_BASE_URL: 'https://shipfox.example.com',
    JIRA_WEBHOOK_SIGNING_SECRET: 'external-consumer-webhook-secret',
    LINEAR_MCP_ENDPOINT: 'https://mcp.linear.app/mcp',
    LINEAR_OAUTH_CLIENT_ID: 'external-consumer-client-id',
    LINEAR_OAUTH_CLIENT_SECRET: 'external-consumer-client-secret',
    LINEAR_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/linear/callback',
    LINEAR_WEBHOOK_SIGNING_SECRET: 'external-consumer-webhook-secret',
    SLACK_API_BASE_URL: 'https://slack.example.com/api',
    SLACK_OAUTH_CLIENT_ID: 'external-consumer-client-id',
    SLACK_OAUTH_CLIENT_SECRET: 'external-consumer-client-secret',
    SLACK_OAUTH_REDIRECT_URL: 'https://shipfox.example.com/integrations/slack/callback',
    SLACK_SIGNING_SECRET: 'external-consumer-signing-secret',
    LOG_STORAGE_S3_ACCESS_KEY_ID: 'external-consumer-access-key',
    LOG_STORAGE_S3_BUCKET: 'shipfox-logs',
    LOG_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:3900',
    LOG_STORAGE_S3_FORCE_PATH_STYLE: 'true',
    LOG_STORAGE_S3_REGION: 'garage',
    LOG_STORAGE_S3_SECRET_ACCESS_KEY: 'external-consumer-secret-key',
    POSTGRES_DATABASE: postgresDatabase,
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
    TEMPORAL_ADDRESS: '127.0.0.1:7233',
    WORKSPACE_JWT_SECRET: 'external-consumer-workspace-secret',
  };
}

function safePackageName(name) {
  return name.replace('@shipfox/', '').replaceAll('/', '-');
}
