import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, parse} from 'node:path';

import {type BundleOptions, bundleWorkflowCode, type WorkflowBundlePath} from '@temporalio/worker';
import {getWorkflowInterceptorModules} from './interceptors.js';

const productionWorkflowConditionNames = ['webpack', 'production', 'node', 'import', 'require'];
const require = createRequire(import.meta.url);

export interface WorkflowBundleMeta {
  temporalWorkerVersion: string;
}

export class MissingWorkflowBundleError extends Error {
  constructor(public readonly workflowsPath: string) {
    super(`Missing production workflow bundle for ${workflowsPath}.`);
    this.name = 'MissingWorkflowBundleError';
  }
}

export class WorkflowBundleVersionMismatchError extends Error {
  constructor(
    public readonly workflowsPath: string,
    public readonly bundleVersion: string,
    public readonly runtimeVersion: string,
  ) {
    super(
      `Workflow bundle for ${workflowsPath} uses @temporalio/worker ${bundleVersion}, but runtime uses ${runtimeVersion}.`,
    );
    this.name = 'WorkflowBundleVersionMismatchError';
  }
}

export function productionWorkflowBundlerOptions(): Pick<BundleOptions, 'webpackConfigHook'> {
  return {
    webpackConfigHook: (webpackConfig) => ({
      ...webpackConfig,
      resolve: {
        ...webpackConfig.resolve,
        conditionNames: productionWorkflowConditionNames,
      },
    }),
  };
}

export function bundleProductionWorkflow(workflowsPath: string) {
  return bundleWorkflowCode({
    workflowsPath,
    workflowInterceptorModules: getWorkflowInterceptorModules(),
    ...productionWorkflowBundlerOptions(),
  });
}

export function productionWorkflowBundlePaths(workflowsPath: string) {
  const entrypoint = parse(workflowsPath);
  const bundleBaseName = `${entrypoint.name}.bundle`;

  return {
    codePath: join(dirname(workflowsPath), `${bundleBaseName}.js`),
    metaPath: join(dirname(workflowsPath), `${bundleBaseName}.meta.json`),
  };
}

export function temporalWorkerVersion(): string {
  return (require('@temporalio/worker/package.json') as {version: string}).version;
}

export async function writeProductionWorkflowBundle(workflowsPath: string): Promise<void> {
  if (!existsSync(workflowsPath)) {
    throw new Error(`Workflow entrypoint does not exist: ${workflowsPath}`);
  }

  const workflowBundle = await bundleProductionWorkflow(workflowsPath);
  const {codePath, metaPath} = productionWorkflowBundlePaths(workflowsPath);
  const meta: WorkflowBundleMeta = {temporalWorkerVersion: temporalWorkerVersion()};

  writeFileSync(codePath, workflowBundle.code);
  writeFileSync(metaPath, `${JSON.stringify(meta)}\n`);
  process.stdout.write(`${workflowsPath}: ${Buffer.byteLength(workflowBundle.code)} bytes\n`);
}

export function loadProductionWorkflowBundle(workflowsPath: string): WorkflowBundlePath {
  const {codePath, metaPath} = productionWorkflowBundlePaths(workflowsPath);

  if (!existsSync(codePath) || !existsSync(metaPath)) {
    throw new MissingWorkflowBundleError(workflowsPath);
  }

  let meta: unknown;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    throw new MissingWorkflowBundleError(workflowsPath);
  }

  if (
    !meta ||
    typeof meta !== 'object' ||
    typeof (meta as WorkflowBundleMeta).temporalWorkerVersion !== 'string'
  ) {
    throw new MissingWorkflowBundleError(workflowsPath);
  }

  const {temporalWorkerVersion: bundleVersion} = meta as WorkflowBundleMeta;
  const runtimeVersion = temporalWorkerVersion();
  if (bundleVersion !== runtimeVersion) {
    throw new WorkflowBundleVersionMismatchError(workflowsPath, bundleVersion, runtimeVersion);
  }

  return {codePath};
}
