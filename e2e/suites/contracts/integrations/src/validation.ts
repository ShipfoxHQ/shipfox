import type {z} from 'zod';

export class CaseValidationError extends Error {
  readonly casePath: string;

  constructor(casePath: string, message: string) {
    super(`${casePath}: ${message}`);
    this.name = 'CaseValidationError';
    this.casePath = casePath;
  }
}

export function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}
