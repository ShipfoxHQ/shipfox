delete process.env.NODE_ENV;

const {createRequire} = await import('node:module');
const {fileURLToPath} = await import('node:url');
const {dirname, join} = await import('node:path');
const temporalRequire = createRequire(import.meta.resolve('@shipfox/node-temporal'));
const {bundleWorkflowCode} = await import(temporalRequire.resolve('@temporalio/worker'));
const packageEntryPoint = fileURLToPath(import.meta.resolve('@shipfox/api-definitions'));
const workflowsPath = join(
  dirname(dirname(packageEntryPoint)),
  'dist',
  'temporal',
  'workflows',
  'index.js',
);

await bundleWorkflowCode({workflowsPath});
