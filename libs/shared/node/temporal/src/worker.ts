import {logger} from '@shipfox/node-opentelemetry';
import {NativeConnection, Worker} from '@temporalio/worker';
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
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivityTaskExecutions ?? 10,
    maxConcurrentWorkflowTaskExecutions: options.maxConcurrentWorkflowTaskExecutions ?? 10,
  });

  logger().info({taskQueue, namespace: config.TEMPORAL_NAMESPACE}, 'Temporal worker created');

  return worker;
}
