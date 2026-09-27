import {createRequire} from 'node:module';

import type {Level, LogFn, LoggerOptions, TransportTargetOptions} from 'pino';
import {config, resolveDestinationLevel} from './config.js';

export type {Level, LogFn} from 'pino';

type PinoModule = typeof import('pino');

const require = createRequire(import.meta.url);
let pinoModule: PinoModule | undefined;

function getPino(): PinoModule {
  if (!pinoModule) pinoModule = require('pino') as PinoModule;
  return pinoModule;
}

const stdoutLevel = resolveDestinationLevel(
  config.LOG_STDOUT_LEVEL,
  config.LOG_LEVEL,
  'LOG_STDOUT_LEVEL',
);
const fileLevel = resolveDestinationLevel(
  config.LOG_FILE_LEVEL,
  config.LOG_LEVEL,
  'LOG_FILE_LEVEL',
);

const transports: TransportTargetOptions[] = [];
if (config.LOG_STDOUT) {
  if (config.LOG_PRETTY) {
    transports.push({target: 'pino-pretty', level: stdoutLevel, options: {colorize: true}});
  } else {
    transports.push({target: 'pino/file', level: stdoutLevel, options: {destination: 1}});
  }
}
if (config.LOG_FILE) {
  transports.push({
    target: 'pino/file',
    level: fileLevel,
    options: {destination: config.LOG_FILE, mkdir: true},
  });
}

function createTransportStream() {
  const pino = getPino();
  return pino.multistream(
    transports.map(({level, options, target}) => {
      const stream =
        options === undefined ? pino.transport({target}) : pino.transport({options, target});
      return {level: level ?? config.LOG_LEVEL, stream};
    }),
  );
}

function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      'message' in value &&
      typeof value.message === 'string' &&
      'stack' in value &&
      typeof value.stack === 'string')
  );
}

function normalizeErrorKey(object: Record<string, unknown>): Record<string, unknown> {
  if (object.err !== undefined || !isErrorLike(object.error)) return object;

  const {error, ...rest} = object;
  return {...rest, err: error};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeErrorArguments(args: Parameters<LogFn>): Parameters<LogFn> {
  const [object, ...rest] = args;
  if (!isRecord(object)) return args;

  const normalizedObject = normalizeErrorKey(object);
  if (normalizedObject === object) return args;

  return [normalizedObject, ...rest] as Parameters<LogFn>;
}

// Headers carry credentials such as `authorization`, `cookie`, and `set-cookie`. Log only request
// headers that help trace a caller, and no response headers.
const LOGGED_REQUEST_HEADERS = ['user-agent', 'x-forwarded-for'];

function pickLoggedHeaders(headers: unknown): Record<string, unknown> {
  if (!isRecord(headers)) return {};
  return Object.fromEntries(
    LOGGED_REQUEST_HEADERS.filter((name) => headers[name] !== undefined).map((name) => [
      name,
      headers[name],
    ]),
  );
}

// HTTP client errors such as ky's HTTPError keep the failed request, including its body and
// headers, on enumerable fields that the error serializer would copy.
const OMITTED_ERROR_FIELDS = new Set(['config', 'options', 'request', 'response']);
const CREDENTIAL_FIELDS = new Set(['authorization', 'cookie', 'proxy-authorization', 'set-cookie']);
const MAX_SCRUB_DEPTH = 10;

function scrubSerializedError(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => scrubSerializedError(item, depth + 1));
  if (!isRecord(value)) return value;

  const scrubbed: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (OMITTED_ERROR_FIELDS.has(key)) continue;
    scrubbed[key] = CREDENTIAL_FIELDS.has(key.toLowerCase())
      ? '[Redacted]'
      : scrubSerializedError(field, depth + 1);
  }
  return scrubbed;
}

export const settings: LoggerOptions = {
  level: config.LOG_LEVEL,
  transport: {targets: transports},
  hooks: {
    logMethod(args, method) {
      Reflect.apply(method, this, normalizeErrorArguments(args));
    },
  },
  get timestamp() {
    return getPino().stdTimeFunctions.isoTime;
  },
  get serializers() {
    const {stdSerializers} = getPino();
    const serializeError = (error: unknown): unknown => {
      const structured = stdSerializers.errWithCause(error as Error);
      const chained = stdSerializers.err(error as Error);
      if (!isRecord(structured) || !isRecord(chained)) return structured;

      return scrubSerializedError({
        ...structured,
        ...(typeof chained.message === 'string' ? {message: chained.message} : {}),
        ...(typeof chained.stack === 'string' ? {stack: chained.stack} : {}),
      });
    };

    return {
      error: serializeError,
      errors: (errors: unknown) => {
        if (Array.isArray(errors)) return errors.map(serializeError);
        return serializeError(errors);
      },
      err: serializeError,
      req: (request: Parameters<typeof stdSerializers.req>[0]) => {
        const {headers, ...serialized} = stdSerializers.req(request);
        return {...serialized, headers: pickLoggedHeaders(headers)};
      },
      res: (response: {statusCode?: number}) => ({statusCode: response.statusCode ?? null}),
    };
  },
};

function withSharedSettings(options: LoggerOptions): LoggerOptions {
  const customLogMethod = options.hooks?.logMethod;
  return {
    ...settings,
    ...options,
    hooks: {
      ...settings.hooks,
      ...options.hooks,
      logMethod(args, method, level) {
        const normalizedArgs = normalizeErrorArguments(args);
        if (customLogMethod) {
          Reflect.apply(customLogMethod, this, [normalizedArgs, method, level]);
        } else {
          Reflect.apply(method, this, normalizedArgs);
        }
      },
    },
  };
}

type PinoLogger = Pick<ReturnType<PinoModule>, Level | 'flush'>;
let logger: PinoLogger | undefined;

function getLogger(): PinoLogger {
  if (!logger) logger = createLogger({});
  return logger;
}

export function createLogger(options: LoggerOptions) {
  const pino = getPino();
  const configuredOptions = withSharedSettings(options);
  if (options.transport) return pino(configuredOptions);

  const {transport: _transport, ...loggerOptions} = configuredOptions;
  return pino(loggerOptions, createTransportStream());
}

export type Logger = {
  [level in Level]: LogFn;
} & {
  flush: (cb?: (error?: Error) => void) => void;
};

function getLogMethod(level: Level): LogFn {
  return (...args: unknown[]) => {
    const currentLogger = getLogger();
    Reflect.apply(currentLogger[level], currentLogger, args);
  };
}

export const log: Logger = {
  trace: getLogMethod('trace'),
  debug: getLogMethod('debug'),
  info: getLogMethod('info'),
  warn: getLogMethod('warn'),
  error: getLogMethod('error'),
  fatal: getLogMethod('fatal'),
  flush: (cb) => getLogger().flush(cb),
};
