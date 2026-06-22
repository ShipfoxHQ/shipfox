import {DiagConsoleLogger, diag} from '@opentelemetry/api';
import {config} from '#config.js';

const logLevels: Record<string, number> = {
  none: 0,
  error: 30,
  warn: 50,
  info: 60,
  debug: 70,
  verbose: 80,
  all: 9999,
};

const logLevel = logLevels[config.OTEL_DIAG_LOG_LEVEL];

if (logLevel) diag.setLogger(new DiagConsoleLogger(), logLevel);
