import {CacheArgumentError, HashFilesLimitError, HashFilesNoMatchError} from '#cache/errors.js';
import {type HashFilesLimits, hashFiles} from '#cache/hash-files.js';

/** What the runner asks the hashing process for, on stdin as JSON. */
export interface HashFilesRequest {
  readonly patterns: readonly string[];
  /** The step working directory. Patterns may only name files inside it. */
  readonly cwd: string;
  readonly limits?: HashFilesLimits | undefined;
}

export type HashFilesFailureKind = 'no-match' | 'limit' | 'invalid';

/** What the hashing process answers, on stdout as JSON. */
export type HashFilesResponse =
  | {readonly ok: true; readonly hash: string; readonly files: number}
  | {
      readonly ok: false;
      readonly error: {readonly kind: HashFilesFailureKind; readonly message: string};
    };

/**
 * Hashes for a runner `hashFiles()` call. A failure the author can fix is an answer, not a throw,
 * so the runner reports it the same way wherever the files were hashed.
 */
export async function runHashFilesRequest(
  request: HashFilesRequest,
  signal?: AbortSignal,
): Promise<HashFilesResponse> {
  try {
    const result = await hashFiles({
      patterns: request.patterns,
      directories: {cwd: request.cwd},
      limits: request.limits,
      signal,
    });
    return {ok: true, hash: result.hash, files: result.files};
  } catch (error) {
    if (error instanceof HashFilesNoMatchError) return failure('no-match', error);
    if (error instanceof HashFilesLimitError) return failure('limit', error);
    if (error instanceof CacheArgumentError) return failure('invalid', error);
    throw error;
  }
}

export function parseHashFilesRequest(value: unknown): HashFilesRequest {
  if (value === null || typeof value !== 'object') throw new TypeError('Invalid hashFiles request');
  const {patterns, cwd, limits} = value as Record<string, unknown>;
  if (!Array.isArray(patterns) || !patterns.every((pattern) => typeof pattern === 'string')) {
    throw new TypeError('Invalid hashFiles request patterns');
  }
  if (typeof cwd !== 'string') throw new TypeError('Invalid hashFiles request cwd');
  return {patterns, cwd, ...(isLimits(limits) ? {limits} : {})};
}

export function parseHashFilesResponse(value: unknown): HashFilesResponse {
  if (value === null || typeof value !== 'object') throw new TypeError('Invalid hashFiles answer');
  const record = value as Record<string, unknown>;
  if (record.ok === true && typeof record.hash === 'string' && typeof record.files === 'number') {
    return {ok: true, hash: record.hash, files: record.files};
  }
  const error = record.error as Record<string, unknown> | undefined;
  if (
    record.ok === false &&
    error !== undefined &&
    (error.kind === 'no-match' || error.kind === 'limit' || error.kind === 'invalid') &&
    typeof error.message === 'string'
  ) {
    return {ok: false, error: {kind: error.kind, message: error.message}};
  }
  throw new TypeError('Invalid hashFiles answer');
}

function failure(kind: HashFilesFailureKind, error: Error): HashFilesResponse {
  return {ok: false, error: {kind, message: error.message}};
}

function isLimits(value: unknown): value is HashFilesLimits {
  if (value === null || typeof value !== 'object') return false;
  const {maxFiles, maxBytes} = value as Record<string, unknown>;
  return typeof maxFiles === 'number' && typeof maxBytes === 'number';
}
