export class ConnectionSlugConflictError extends Error {
  constructor(cause: unknown) {
    super('Could not allocate a unique integration connection slug. Try again.', {cause});
    this.name = 'ConnectionSlugConflictError';
  }
}
