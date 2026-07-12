import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {closePostgresClient, createPostgresClient, type Pool} from '@shipfox/node-postgres';
import {drizzle} from 'drizzle-orm/node-postgres';
import {runMigrations} from './client.js';

const moduleAMigrations = fileURLToPath(new URL('../test/fixtures/module-a', import.meta.url));
const moduleBMigrations = fileURLToPath(new URL('../test/fixtures/module-b', import.meta.url));

let adminPool: Pool;

beforeAll(() => {
  adminPool = createPostgresClient({database: 'postgres'});
});

afterAll(async () => {
  await closePostgresClient();
});

async function withFreshDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `node_drizzle_test_${randomUUID().replaceAll('-', '')}`;
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  await closePostgresClient();
  const testPool = createPostgresClient({database: databaseName});

  try {
    await run(testPool);
  } finally {
    await closePostgresClient();
    adminPool = createPostgresClient({database: 'postgres'});
    await adminPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
  }
}

describe('runMigrations', () => {
  it('keeps migration history isolated by table name', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);

      await runMigrations(database, moduleAMigrations, 'node_drizzle_module_a_migrations');
      await runMigrations(database, moduleBMigrations, 'node_drizzle_module_b_migrations');

      const histories = await pool.query<{table_name: string}>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'drizzle' ORDER BY table_name",
      );
      expect(histories.rows).toEqual([
        {table_name: 'node_drizzle_module_a_migrations'},
        {table_name: 'node_drizzle_module_b_migrations'},
      ]);

      const migrationCounts = await pool.query<{module_a: number; module_b: number}>(
        'SELECT (SELECT count(*)::int FROM drizzle.node_drizzle_module_a_migrations) AS module_a, (SELECT count(*)::int FROM drizzle.node_drizzle_module_b_migrations) AS module_b',
      );
      expect(migrationCounts.rows).toEqual([{module_a: 1, module_b: 1}]);
    });
  });

  it('serializes concurrent migration setup on a fresh database', async () => {
    await withFreshDatabase(async (pool) => {
      const database = drizzle(pool);

      await Promise.all([
        runMigrations(database, moduleAMigrations, 'node_drizzle_module_a_migrations'),
        runMigrations(database, moduleBMigrations, 'node_drizzle_module_b_migrations'),
      ]);

      const tables = await pool.query<{table_name: string}>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'node_drizzle_test_%' ORDER BY table_name",
      );
      expect(tables.rows).toEqual([
        {table_name: 'node_drizzle_test_module_a'},
        {table_name: 'node_drizzle_test_module_b'},
      ]);
    });
  });
});
