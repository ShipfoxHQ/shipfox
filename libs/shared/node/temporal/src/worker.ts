import {logger} from '@shipfox/node-opentelemetry';
import {type BundleOptions, bundleWorkflowCode, NativeConnection, Worker} from '@temporalio/worker';
import {config} from './config.js';
import {getTemporalConnectionOptions, temporalConnectionError} from './connection-options.js';
import {getWorkerInterceptors, getWorkflowInterceptorModules} from './interceptors.js';

export interface CreateWorkerOptions {
  connection?: NativeConnection;
  taskQueue?: string;
  workflowsPath: string;
  activities: object;
  maxConcurrentActivityTaskExecutions?: number;
  maxConcurrentWorkflowTaskExecutions?: number;
}

const productionWorkflowConditionNames = ['webpack', 'production', 'node', 'import', 'require'];

/**
 * Makes Temporal's runtime workflow bundler resolve first-party packages from compiled output.
 */
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

/**
 * Bundles a workflow entrypoint with the same production resolution used by Temporal workers.
 */
export function bundleProductionWorkflow(workflowsPath: string) {
  return bundleWorkflowCode({
    workflowsPath,
    workflowInterceptorModules: getWorkflowInterceptorModules(),
    ...productionWorkflowBundlerOptions(),
  });
}

export async function createTemporalWorkerConnection(): Promise<NativeConnection> {
  try {
    return await NativeConnection.connect(getTemporalConnectionOptions());
  } catch (error) {
    throw temporalConnectionError(error);
  }
}

export async function createTemporalWorker(options: CreateWorkerOptions): Promise<Worker> {
  const connection = options.connection ?? (await createTemporalWorkerConnection());
  const taskQueue = options.taskQueue ?? config.TEMPORAL_TASK_QUEUE;

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue,
    workflowsPath: options.workflowsPath,
    activities: options.activities,
    interceptors: {
      ...getWorkerInterceptors(),
      workflowModules: getWorkflowInterceptorModules(),
    },
    ...(process.env.NODE_ENV === 'production'
      ? {bundlerOptions: productionWorkflowBundlerOptions()}
      : {}),
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivityTaskExecutions ?? 10,
    maxConcurrentWorkflowTaskExecutions: options.maxConcurrentWorkflowTaskExecutions ?? 10,
  });

  logger().info({taskQueue, namespace: config.TEMPORAL_NAMESPACE}, 'Temporal worker created');

  return worker;
}
