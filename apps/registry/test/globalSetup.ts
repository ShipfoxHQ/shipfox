import './env.js';
import {closePostgresClient, createPostgresClient, pgClient} from '@shipfox/node-postgres';
import {closeDb} from '#db/db.js';
import {migrateRegistryDatabase} from '#db/migrations.js';

const TEST_DATABASE = 'registry_test';

// The registry owns its database, so a development volume that predates it lacks the test one.
async function ensureTestDatabase() {
  createPostgresClient({database: 'postgres'});
  try {
    const existing = await pgClient().query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE,
    ]);
    if (existing.rowCount === 0) await pgClient().query(`CREATE DATABASE ${TEST_DATABASE}`);
  } catch (error) {
    // Two workers creating it at once is fine: the database exists either way.
    if ((error as {code?: string}).code !== '42P04') throw error;
  } finally {
    await closePostgresClient();
  }
}

export async function setup() {
  await ensureTestDatabase();
  createPostgresClient();
  await migrateRegistryDatabase();
  closeDb();
  await closePostgresClient();
}
