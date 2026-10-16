import './env.js';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {afterAll, beforeAll} from '@shipfox/vitest/vi';
import {closeDb} from '#db/db.js';

beforeAll(() => {
  createPostgresClient();
});

afterAll(async () => {
  closeDb();
  await closePostgresClient();
});
