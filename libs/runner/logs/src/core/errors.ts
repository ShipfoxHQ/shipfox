/**
 * Thrown when a step id is not the UUID the API contract guarantees, so it cannot
 * be used in the spool filename (path-traversal guard, mirroring the workspace's
 * job-id guard).
 */
export class InvalidStepIdError extends Error {
  constructor(public readonly stepId: string) {
    super(`Invalid step id: ${stepId}`);
    this.name = 'InvalidStepIdError';
  }
}
