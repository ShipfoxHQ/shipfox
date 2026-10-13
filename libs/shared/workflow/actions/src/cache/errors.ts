/** The caller passed `paths`, a key, or a scope that can never work. Thrown, never a miss. */
export class CacheArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheArgumentError';
  }
}

/**
 * A restore failed while writing files. Extraction merges into the job's directories and cannot
 * roll back, so they may be partly written. Everything before extraction is a miss instead.
 */
export class CacheExtractionError extends Error {
  /** The directory the segment was being extracted into. */
  readonly directory: string;

  constructor(params: {directory: string; message: string; cause?: unknown}) {
    super(params.message, params.cause === undefined ? undefined : {cause: params.cause});
    this.name = 'CacheExtractionError';
    this.directory = params.directory;
  }
}

/** The local endpoint or the storage answered with a status the SDK does not retry or treats as final. */
export class CacheHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(params: {status: number; code?: string | undefined; message: string}) {
    super(params.message);
    this.name = 'CacheHttpError';
    this.status = params.status;
    this.code = params.code;
  }
}

/** No bytes moved for the stall timeout. */
export class CacheStallError extends Error {
  constructor(what: string, stallMs: number) {
    super(`${what} stalled: no data for ${Math.round(stallMs / 1000)} s.`);
    this.name = 'CacheStallError';
  }
}

/** A failure on the local disk or in `tar`. Retrying a transfer would not help. */
export class CacheLocalError extends Error {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'CacheLocalError';
  }
}

/** An answer or an archive that does not have the expected shape. */
export class CacheProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CacheProtocolError';
  }
}

/** An object that is gone from storage: the entry was deleted meanwhile. Not worth a retry. */
export class CacheObjectGoneError extends Error {
  constructor(what: string) {
    super(`${what}: the object is gone from storage.`);
    this.name = 'CacheObjectGoneError';
  }
}
