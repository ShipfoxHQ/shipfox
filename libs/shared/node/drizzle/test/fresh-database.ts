import {randomUUID} from 'node:crypto';
import {closePostgresClient, createPostgresClient, type Pool} from '@shipfox/node-postgres';

/** Runs `run` against a new, empty database, and drops it afterward. */
export async function withFreshDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const databaseName = `node_drizzle_test_${randomUUID().replaceAll('-', '')}`;
  const adminPool = createPostgresClient({database: 'postgres'});
  await adminPool.query(`CREATE DATABASE ${databaseName}`);
  await closePostgresClient();
  const testPool = createPostgresClient({database: databaseName});

  try {
    await run(testPool);
  } finally {
    await closePostgresClient();
    const cleanupPool = createPostgresClient({database: 'postgres'});
    await cleanupPool.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await closePostgresClient();
  }
}
