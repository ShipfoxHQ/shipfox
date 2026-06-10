export class DefinitionNotFoundError extends Error {
  constructor(definitionId: string) {
    super(`Definition not found: ${definitionId}`);
    this.name = 'DefinitionNotFoundError';
  }
}

export class ProjectMismatchError extends Error {
  constructor(definitionProjectId: string, requestProjectId: string) {
    super(
      `Definition belongs to project ${definitionProjectId}, but request targets project ${requestProjectId}`,
    );
    this.name = 'ProjectMismatchError';
  }
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found or has no steps: ${jobId}`);
    this.name = 'JobNotFoundError';
  }
}

export class StepNotFoundError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} not found in job ${jobId}`);
    this.name = 'StepNotFoundError';
  }
}

export class StepNotRunningError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} in job ${jobId} is not running and cannot accept a result`);
    this.name = 'StepNotRunningError';
  }
}
