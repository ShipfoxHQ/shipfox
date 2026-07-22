import './env.js';
import {closePostgresClient, createPostgresClient} from '@shipfox/node-postgres';
import {afterAll, afterEach, beforeAll, vi} from '@shipfox/vitest/vi';
import {closeDb} from '#db/index.js';
import {resetRunnersTestClient} from '#test/fixtures/runners-inter-module.js';

beforeAll(() => {
  createPostgresClient();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRunnersTestClient();
});

afterAll(async () => {
  closeDb();
  await closePostgresClient();
});
