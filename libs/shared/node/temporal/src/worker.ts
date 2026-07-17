import {logger} from '@shipfox/node-opentelemetry';
import {NativeConnection, Worker, type WorkerOptions} from '@temporalio/worker';
import {loadProductionWorkflowBundle} from './bundle.js';
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

function resolveWorkflowSource(
  workflowsPath: string,
): Pick<WorkerOptions, 'workflowsPath' | 'workflowBundle' | 'interceptors'> {
  if (process.env.NODE_ENV === 'production') {
    return {workflowBundle: loadProductionWorkflowBundle(workflowsPath)};
  }

  return {
    workflowsPath,
    interceptors: {workflowModules: getWorkflowInterceptorModules()},
  };
}

export async function createTemporalWorkerConnection(): Promise<NativeConnection> {
  try {
    return await NativeConnection.connect(getTemporalConnectionOptions());
  } catch (error) {
    throw temporalConnectionError(error);
  }
}

export async function createTemporalWorker(options: CreateWorkerOptions): Promise<Worker> {
  const taskQueue = options.taskQueue ?? config.TEMPORAL_TASK_QUEUE;
  const workflowSource = resolveWorkflowSource(options.workflowsPath);
  const {interceptors: workflowInterceptors, ...workflowOptions} = workflowSource;
  const connection = options.connection ?? (await createTemporalWorkerConnection());

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue,
    activities: options.activities,
    interceptors: {
      ...getWorkerInterceptors(),
      ...workflowInterceptors,
    },
    ...workflowOptions,
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivityTaskExecutions ?? 10,
    maxConcurrentWorkflowTaskExecutions: options.maxConcurrentWorkflowTaskExecutions ?? 10,
  });

  logger().info({taskQueue, namespace: config.TEMPORAL_NAMESPACE}, 'Temporal worker created');

  return worker;
}
