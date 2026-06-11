import {createConfig, host, num, str} from '@shipfox/config';

export const config = createConfig({
  POSTGRES_HOST: host({
    desc: 'Hostname of the PostgreSQL server.',
    default: 'localhost',
  }),
  POSTGRES_PORT: num({
    desc: 'Port of the PostgreSQL server.',
    default: 5432,
  }),
  POSTGRES_USERNAME: str({
    desc: 'Username used to connect to PostgreSQL.',
    default: 'shipfox',
  }),
  POSTGRES_PASSWORD: str({
    desc: 'Password used to connect to PostgreSQL. Set a strong value in production.',
    default: 'password',
  }),
  POSTGRES_DATABASE: str({
    desc: 'Name of the PostgreSQL database to use.',
    default: 'api',
  }),
  POSTGRES_MAX_CONNECTIONS: num({
    desc: 'Largest number of connections the pool keeps open. Higher values allow more queries at once but use more resources.',
    default: 10,
  }),
});
