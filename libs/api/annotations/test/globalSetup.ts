import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';

export async function setup() {
  createPostgresClient();

  await db().execute(sql`DROP TABLE IF EXISTS annotations_annotations CASCADE`);
  await db().execute(sql`DROP TABLE IF EXISTS annotations CASCADE`);
  await db().execute(sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations_annotations CASCADE`);
  await db().execute(sql`DROP TYPE IF EXISTS annotations_style CASCADE`);
  await runMigrations(db(), migrationsPath, '__drizzle_migrations_annotations');
  await db().execute(sql`TRUNCATE annotations_annotations CASCADE`);

  closeDb();
  await closePostgresClient();
}
