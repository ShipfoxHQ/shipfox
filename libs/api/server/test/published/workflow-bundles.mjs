process.env.INTEGRATIONS_ENABLE_SENTRY_PROVIDER = 'true';
process.env.NODE_ENV = 'production';

const {readdir, readFile} = await import('node:fs/promises');
const {dirname, join} = await import('node:path');
const {defaultModules} = await import('@shipfox/api-server');
const {loadProductionWorkflowBundle} = await import('@shipfox/node-temporal');
const modules = await defaultModules();
const workflowPaths = new Set(
  modules.flatMap((module) => module.workers ?? []).map((worker) => worker.workflowsPath),
);

if (!workflowPaths.size) throw new Error('Packed API server declares no workflow entrypoints.');

const bundles = new Map();
for (const workflowsPath of workflowPaths) {
  const workflowBundle = loadProductionWorkflowBundle(workflowsPath);
  bundles.set(workflowsPath, workflowBundle);

  const code = await readFile(workflowBundle.codePath, 'utf8');
  if (/@shipfox[/\\][^/\\]+[/\\]src[/\\]/u.test(code)) {
    throw new Error(`Workflow bundle for ${workflowsPath} resolved a first-party source path.`);
  }
}

const declaredCodePaths = new Set([...bundles.values()].map(({codePath}) => codePath));
if (declaredCodePaths.size !== workflowPaths.size) {
  throw new Error('Packed API workflow entrypoints do not map one-to-one to prebuilt bundles.');
}

const workflowDirectories = new Set(
  [...workflowPaths].map((workflowsPath) => dirname(workflowsPath)),
);
const emittedBundles = (
  await Promise.all(
    [...workflowDirectories].map(async (directory) =>
      (
        await readdir(directory)
      )
        .filter((entry) => entry.endsWith('.bundle.js'))
        .map((entry) => join(directory, entry)),
    ),
  )
).flat();
const unreferencedBundles = emittedBundles.filter((codePath) => !declaredCodePaths.has(codePath));
if (unreferencedBundles.length) {
  throw new Error(
    `Packed API contains unreferenced workflow bundles: ${unreferencedBundles.join(', ')}`,
  );
}
