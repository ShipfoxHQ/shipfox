import {drizzle, type NodePgDatabase} from '@shipfox/node-drizzle';
import {pgClient} from '@shipfox/node-postgres';
import {secretDataKeys} from './schema/data-keys.js';
import {secretValues} from './schema/values.js';
import {secretVariables} from './schema/variables.js';

export const schema = {
  secretDataKeys,
  secretValues,
  secretVariables,
};

let _db: NodePgDatabase<typeof schema> | undefined;

export function db() {
  if (!_db) _db = drizzle(pgClient(), {schema});
  return _db;
}

export function closeDb(): void {
  _db = undefined;
}

export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
