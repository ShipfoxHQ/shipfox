import {DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH} from '@shipfox/api-definitions-dto';
import type {DefinitionSyncErrorCode} from './entities/sync-state.js';
import type {ValidationError} from './validate-definition.js';

export class DefinitionParseError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(limitDefinitionSyncErrorMessage(message));
    this.name = 'DefinitionParseError';
  }
}

export class DefinitionSyncPermanentError extends Error {
  constructor(
    public readonly code: DefinitionSyncErrorCode,
    message: string,
    public readonly details: readonly ValidationError[] = [],
    public readonly filePath?: string | undefined,
  ) {
    super(limitDefinitionSyncErrorMessage(message));
    this.name = 'DefinitionSyncPermanentError';
  }
}

export function limitDefinitionSyncErrorMessage(message: string): string {
  const maxLength = DEFINITION_SYNC_LAST_ERROR_MESSAGE_MAX_LENGTH;
  if (message.length <= maxLength) return message;

  let contentLength = maxLength - 1;
  const lastCodeUnit = message.charCodeAt(contentLength - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) contentLength -= 1;

  return `${message.slice(0, contentLength)}…`;
}

export type ActionResolutionErrorCode =
  | 'action-not-found'
  | 'action-invalid'
  | 'action-too-large'
  | 'action-unsupported-file';

/**
 * Rejects an action directory referenced with `uses`. `filePath` names the
 * repository file the problem belongs to: the manifest, the offending file,
 * or the workflow file for a per-workflow limit.
 */
export class ActionResolutionError extends Error {
  readonly code: ActionResolutionErrorCode;
  readonly details: readonly ValidationError[];
  readonly filePath: string | undefined;

  constructor(params: {
    code: ActionResolutionErrorCode;
    message: string;
    details?: readonly ValidationError[] | undefined;
    filePath?: string | undefined;
  }) {
    super(params.message);
    this.name = 'ActionResolutionError';
    this.code = params.code;
    this.details = params.details ?? [];
    this.filePath = params.filePath;
  }
}

/**
 * Rejects a prompt file that a `file` prompt part names. `path` is the part's
 * place in the document, and `filePath` is the workflow file that holds it.
 */
export class PromptFileResolutionError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly filePath: string,
  ) {
    super(message);
    this.name = 'PromptFileResolutionError';
  }
}

export type DefinitionAtRefErrorCode =
  | 'project-not-found'
  | 'ref-not-found'
  | 'ref-invalid'
  | 'ref-moved'
  | 'file-not-found'
  | 'content-too-large'
  | 'invalid-definition'
  | 'too-many-files'
  | 'source-unavailable';

/**
 * Rejects a definition resolution or listing at a git ref. `details` carries
 * the bounded context the presentation translates into known-error details.
 */
export class DefinitionAtRefError extends Error {
  constructor(
    public readonly code: DefinitionAtRefErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DefinitionAtRefError';
  }
}
