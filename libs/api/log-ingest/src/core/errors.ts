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
