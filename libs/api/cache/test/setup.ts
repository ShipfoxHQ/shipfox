import './env.js';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {afterAll, afterEach, beforeAll, vi} from '@shipfox/vitest/vi';
import {closeS3Client} from '#api/object-storage.js';
import {closeDb} from '#db/db.js';

beforeAll(() => {
  createPostgresClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  closeS3Client();
  closeDb();
  await closePostgresClient();
});
