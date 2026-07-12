import pg from 'pg';
import {config} from './config.js';
import {createPoolConfig} from './pool-config.js';

export type * from 'pg';

export {DatabaseError} from 'pg';

let _pool: pg.Pool | undefined;

export function createPostgresClient(options?: pg.PoolConfig): pg.Pool {
  if (_pool) {
    throw new Error('Postgres client has already been created');
  }

  _pool = new pg.Pool(createPoolConfig(config, options));
  return _pool;
}

export function pgClient(): pg.Pool {
  if (!_pool) {
    throw new Error('Postgres client has not been created');
  }
  return _pool;
}

export async function closePostgresClient() {
  await _pool?.end();
  _pool = undefined;
}

export async function isPostgresHealthy() {
  if (!_pool) return false;
  try {
    const health = await _pool?.query('SELECT 1');
    return health.rowCount === 1;
  } catch (_err) {
    return false;
  }
}
