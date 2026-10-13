export class ReservedScopeError extends Error {
  constructor(public readonly scope: string) {
    super(`Scope ${scope} uses the reserved dev/ prefix`);
    this.name = 'ReservedScopeError';
  }
}

export class RunNotFoundError extends Error {
  constructor(public readonly workflowRunId: string) {
    super(`Workflow run ${workflowRunId} not found`);
    this.name = 'RunNotFoundError';
  }
}

export class CacheEntryNotFoundError extends Error {
  constructor(public readonly entryId: string) {
    super(`Cache entry ${entryId} not found for this job execution`);
    this.name = 'CacheEntryNotFoundError';
  }
}

export class CacheEntryNotCommittableError extends Error {
  constructor(public readonly entryId: string) {
    super(`Cache entry ${entryId} has no multipart upload to complete`);
    this.name = 'CacheEntryNotCommittableError';
  }
}

export class InvalidUploadError extends Error {
  constructor(public readonly entryId: string) {
    super(`Object storage rejected the parts of cache entry ${entryId}`);
    this.name = 'InvalidUploadError';
  }
}

export class UploadObjectMissingError extends Error {
  constructor(public readonly entryId: string) {
    super(`Cache entry ${entryId} has no object in storage after completing the upload`);
    this.name = 'UploadObjectMissingError';
  }
}

export class UploadSizeMismatchError extends Error {
  constructor(
    public readonly entryId: string,
    public readonly reservedBytes: number,
    public readonly storedBytes: number | undefined,
  ) {
    super(
      `Cache entry ${entryId} reserved ${reservedBytes} bytes but storage holds ${storedBytes ?? 'an unknown size'}`,
    );
    this.name = 'UploadSizeMismatchError';
  }
}
