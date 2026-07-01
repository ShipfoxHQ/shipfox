import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export {countWorkspaceEntries} from './cap.js';
export {
  getDataKey,
  insertDataKeyIfAbsent,
  listDataKeysPage,
  listDataKeyVersions,
  updateDataKeyWrapCas,
} from './data-keys.js';
export {closeDb, db, schema, type Tx} from './db.js';
export {secretDataKeys} from './schema/data-keys.js';
export {secretValues} from './schema/values.js';
export {secretVariables} from './schema/variables.js';
export type {StoreScope} from './scope.js';
export {
  deleteSecretValueRows,
  getSecretValueRowWithPrecedence,
  listSecretValueRowsByNamespace,
  upsertSecretValueRows,
} from './values.js';
export {
  deleteSecretVariableRows,
  getSecretVariableRowWithPrecedence,
  listSecretVariableRowsByNamespace,
  upsertSecretVariableRows,
} from './variables.js';

export const migrationsPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
