import './env.js';
import {emailChallengesModule} from '@shipfox/api-email-challenges';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_auth');
  const emailChallengesDatabase = emailChallengesModule.database;
  const emailChallengesMigrations =
    emailChallengesDatabase && !Array.isArray(emailChallengesDatabase)
      ? emailChallengesDatabase.migrationsPath
      : undefined;
  if (!emailChallengesMigrations)
    throw new Error('Email challenges module has no database migrations');
  await runMigrations(db(), emailChallengesMigrations, '__drizzle_migrations_email_challenges');
  await db().execute(
    sql`TRUNCATE email_challenges_challenges, email_challenges_send_limits, auth_outbox, auth_password_resets, auth_rate_limits, auth_refresh_tokens, auth_users CASCADE`,
  );

  closeDb();
  await closePostgresClient();
}
