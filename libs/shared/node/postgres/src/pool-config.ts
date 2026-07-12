import type {PoolConfig} from 'pg';
import type {PostgresConfig} from './config.js';

export function createPoolConfig(config: PostgresConfig, options?: PoolConfig): PoolConfig {
  return {
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    database: config.POSTGRES_DATABASE,
    user: config.POSTGRES_USERNAME,
    password: config.POSTGRES_PASSWORD,
    max: config.POSTGRES_MAX_CONNECTIONS,
    keepAlive: true,
    idleTimeoutMillis: config.POSTGRES_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.POSTGRES_CONNECTION_TIMEOUT_MS,
    ssl: config.POSTGRES_TLS_MODE === 'verify-full' ? {rejectUnauthorized: true} : false,
    ...options,
  };
}
