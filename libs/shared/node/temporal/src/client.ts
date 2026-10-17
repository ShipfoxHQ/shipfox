import {logger} from '@shipfox/node-opentelemetry';
import {processState} from '@shipfox/node-process-state';
import {Client, Connection} from '@temporalio/client';
import {config} from './config.js';
import {getTemporalConnectionOptions, temporalConnectionError} from './connection-options.js';
import {getClientInterceptors} from './interceptors.js';
import {installTemporalRuntime} from './runtime.js';

interface TemporalClientState {
  connection?: Connection | undefined;
  client?: Client | undefined;
}

const state = processState<TemporalClientState>(
  '@shipfox/node-temporal/client/v1',
  () => ({}),
  import.meta.url,
);

export async function createTemporalClient(): Promise<Client> {
  installTemporalRuntime();
  try {
    state.connection = await Connection.connect(getTemporalConnectionOptions());
  } catch (error) {
    throw temporalConnectionError(error);
  }

  state.client = new Client({
    connection: state.connection,
    namespace: config.TEMPORAL_NAMESPACE,
    interceptors: getClientInterceptors(),
  });

  logger().info(
    {address: config.TEMPORAL_ADDRESS, namespace: config.TEMPORAL_NAMESPACE},
    'Temporal client connected',
  );

  return state.client;
}

export function temporalClient(): Client {
  if (!state.client) {
    throw new Error('Temporal client has not been created');
  }
  return state.client;
}

export async function closeTemporalClient(): Promise<void> {
  await state.connection?.close();
  state.connection = undefined;
  state.client = undefined;
}

export async function isTemporalHealthy(): Promise<boolean> {
  if (!state.connection) return false;
  try {
    await state.connection.healthService.check({});
    return true;
  } catch {
    return false;
  }
}
