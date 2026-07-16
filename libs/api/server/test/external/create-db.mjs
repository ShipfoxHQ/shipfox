import {closePostgresClient, createPostgresClient, pgClient} from '@shipfox/node-postgres';

const DATABASE_NAME = 'shipfox_api_server_external';

try {
  createPostgresClient();
  await pgClient().query(`DROP DATABASE IF EXISTS ${DATABASE_NAME}`);
  await pgClient().query(`CREATE DATABASE ${DATABASE_NAME}`);
} finally {
  await closePostgresClient();
}
