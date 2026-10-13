import './env.js';
import {runMigrations} from '@shipfox/node-drizzle';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {sql} from 'drizzle-orm';
import {checkBucketReachable, closeS3Client} from '#api/object-storage.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';

const BUCKET_READY_TIMEOUT_MS = 30_000;
const BUCKET_READY_POLL_INTERVAL_MS = 500;

// `garage-init` exits 0 once it has posted the key/bucket ACLs, but Garage does not guarantee
// those are immediately usable. Poll HeadBucket so the suite never races the ACL propagation.
async function waitForBucketReachable(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkBucketReachable()) return;
    await new Promise((resolve) => setTimeout(resolve, BUCKET_READY_POLL_INTERVAL_MS));
  }
  if (!(await checkBucketReachable())) {
    throw new Error(
      `Garage bucket not reachable after ${timeoutMs / 1000}s; ` +
        'check that the garage + garage-init compose services are up and the access key is provisioned.',
    );
  }
}

export async function setup() {
  createPostgresClient();

  await runMigrations(db(), migrationsPath, '__drizzle_migrations_cache');
  await db().execute(sql`TRUNCATE cache_entries, cache_deletions, cache_workspace_settings`);

  closeDb();
  await closePostgresClient();

  await waitForBucketReachable(BUCKET_READY_TIMEOUT_MS);
  closeS3Client();
}
