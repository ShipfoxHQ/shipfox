import {bool, createConfig, str} from '@shipfox/config';

export const config = createConfig({
  LOG_LEVEL: str({
    desc: 'Lowest log level that gets written. Accepts fatal, error, warn, info, debug, trace, or silent.',
    default: 'info',
  }),
  LOG_PRETTY: bool({
    desc: 'Formats logs for human reading instead of JSON. Use it in local development.',
    default: false,
  }),
  LOG_STDOUT: bool({
    desc: 'Writes logs to standard output. Turn it off to log only to a file.',
    default: true,
  }),
  LOG_FILE: str({
    desc: 'Path to a file that also receives logs. Parent folders are created if needed. Leave it unset to disable file logging.',
    default: undefined,
  }),
});
