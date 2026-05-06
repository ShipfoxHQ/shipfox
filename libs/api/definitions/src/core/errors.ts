import type {DefinitionSyncErrorCode} from './entities/sync-state.js';

export class DefinitionParseError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'DefinitionParseError';
  }
}

export class DefinitionSyncPermanentError extends Error {
  constructor(
    public readonly code: DefinitionSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DefinitionSyncPermanentError';
  }
}
