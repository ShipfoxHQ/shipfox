import {createConfig, num, str} from '@shipfox/config';
import {createConsoleMailer, createSmtpMailer, type Mailer} from '@shipfox/node-mailer';

export const config = createConfig({
  AUTH_JWT_SECRET: str({
    desc: 'Secret used to sign and verify user access tokens (JWTs). Required, with no default, so startup fails when it is missing.',
  }),
  AUTH_JWT_EXPIRES_IN: str({
    desc: 'How long an access token stays valid. Accepts a duration string such as 15m, 1h, or 7d.',
    default: '15m',
  }),
  AUTH_JOB_LEASE_TOKEN_SECRET: str({
    desc: 'Secret used to sign and verify job lease tokens. Required, with no default, so startup fails when it is missing.',
  }),
  AUTH_JOB_LEASE_TOKEN_EXPIRES_IN: str({
    desc: 'How long a job lease token stays valid. Set it longer than the longest job (JOB_MAX_DURATION is 60 minutes) plus a safety margin.',
    default: '90m',
  }),
  AUTH_REFRESH_TOKEN_EXPIRES_IN_DAYS: num({
    desc: 'How many days a refresh token stays valid before the user must sign in again.',
    default: 14,
  }),
  AUTH_REFRESH_COOKIE_NAME: str({
    desc: 'Name of the browser cookie that stores the refresh token.',
    default: 'shipfox_refresh_token',
  }),
  CLIENT_BASE_URL: str({
    desc: 'Base URL of the client app. Used to build links in emails such as password resets.',
    default: 'http://localhost:3000',
  }),
  MAILER_TRANSPORT: str({
    desc: 'How emails are delivered. Use console to print them to the log, or smtp to send them through an SMTP server.',
    choices: ['console', 'smtp'],
    default: 'console',
  }),
  MAILER_FROM: str({
    desc: 'Sender address shown on outgoing emails.',
    default: 'noreply@shipfox.local',
  }),
  SMTP_HOST: str({
    desc: 'Hostname of the SMTP server. Required when MAILER_TRANSPORT is smtp.',
    default: undefined,
  }),
  SMTP_PORT: num({
    desc: 'Port of the SMTP server.',
    default: 587,
  }),
  SMTP_USER: str({
    desc: 'Username for SMTP authentication. Leave it unset if the server needs no login.',
    default: undefined,
  }),
  SMTP_PASSWORD: str({
    desc: 'Password for SMTP authentication. Leave it unset if the server needs no login.',
    default: undefined,
  }),
});

function createMailer(): Mailer {
  if (config.MAILER_TRANSPORT === 'smtp') {
    if (!config.SMTP_HOST) throw new Error('SMTP_HOST is required when MAILER_TRANSPORT=smtp');
    return createSmtpMailer({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      ...(config.SMTP_USER ? {user: config.SMTP_USER} : {}),
      ...(config.SMTP_PASSWORD ? {password: config.SMTP_PASSWORD} : {}),
      from: config.MAILER_FROM,
    });
  }

  return createConsoleMailer({from: config.MAILER_FROM});
}

export const mailer = createMailer();
