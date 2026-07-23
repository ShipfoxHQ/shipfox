import './env.js';
import {
  initializeEmailChallengesForTests,
  resetEmailChallengesForTests,
} from '@shipfox/api-email-challenges/test';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {closeDb} from '#db/db.js';

export async function setup() {
  createPostgresClient();
  await initializeEmailChallengesForTests();
  await resetEmailChallengesForTests();
  closeDb();
  await closePostgresClient();
}
