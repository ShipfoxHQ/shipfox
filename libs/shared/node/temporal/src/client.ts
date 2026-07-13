import {logger} from '@shipfox/node-opentelemetry';
import {Client, Connection} from '@temporalio/client';
import {config} from './config.js';
import {getTemporalConnectionOptions, temporalConnectionError} from './connection-options.js';
import {getClientInterceptors} from './interceptors.js';

let _connection: Connection | undefined;
let _client: Client | undefined;

export async function createTemporalClient(): Promise<Client> {
  try {
    _connection = await Connection.connect(getTemporalConnectionOptions());
  } catch (error) {
    throw temporalConnectionError(error);
  }

  _client = new Client({
    connection: _connection,
    namespace: config.TEMPORAL_NAMESPACE,
    interceptors: getClientInterceptors(),
  });

  logger().info(
    {address: config.TEMPORAL_ADDRESS, namespace: config.TEMPORAL_NAMESPACE},
    'Temporal client connected',
  );

  return _client;
}

export function temporalClient(): Client {
  if (!_client) {
    throw new Error('Temporal client has not been created');
  }
  return _client;
}

export async function closeTemporalClient(): Promise<void> {
  await _connection?.close();
  _connection = undefined;
  _client = undefined;
}

export async function isTemporalHealthy(): Promise<boolean> {
  if (!_connection) return false;
  try {
    await _connection.healthService.check({});
    return true;
  } catch {
    return false;
  }
}
