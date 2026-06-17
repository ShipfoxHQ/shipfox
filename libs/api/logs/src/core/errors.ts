/** The append offset is ahead of the committed length: the runner must rewind its spool cursor. */
export class OffsetGapError extends Error {
  constructor(public readonly committedLength: number) {
    super(`Append offset is ahead of the committed length (${committedLength})`);
    this.name = 'OffsetGapError';
  }
}

/** The append body is not whole, newline-terminated NDJSON records of the v1 contract. */
export class MalformedLogChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedLogChunkError';
  }
}

/**
 * The lease's `(workspaceId, projectId, runId)` does not match the values
 * stamped on the existing stream row. Since these are functionally determined
 * by `jobId` via workflows FKs, a mismatch implies a forged token or a
 * cross-job lease confusion — never a legitimate request.
 */
export class LeaseStreamMismatchError extends Error {
  constructor() {
    super('Lease identity does not match the existing stream row');
    this.name = 'LeaseStreamMismatchError';
  }
}
