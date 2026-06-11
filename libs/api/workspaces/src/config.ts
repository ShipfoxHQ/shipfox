import {createConfig, num, str} from '@shipfox/config';
import {createConsoleMailer, createSmtpMailer, type Mailer} from '@shipfox/node-mailer';

export const config = createConfig({
  CLIENT_BASE_URL: str({
    desc: 'Base URL of the client app. Used to build links in workspace invitation emails.',
    default: 'http://localhost:3000',
  }),
  MAILER_TRANSPORT: str({
    desc: 'How emails are delivered. Use console to print them to the log, or smtp to send them through an SMTP server.',
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
