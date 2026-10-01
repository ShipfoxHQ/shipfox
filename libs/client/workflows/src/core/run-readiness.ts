import type {RunIssue, RunIssueEffect} from './run-issue-copy.js';

export function runIssueEffect(issue: RunIssue): RunIssueEffect {
  switch (issue.kind) {
    case 'trigger-secret-missing':
      return 'blocks-start';
    case 'secret-input-unmapped':
      return 'fails-job';
    default:
      return issue.effect;
  }
}

export interface NeedsSetupSummary {
  count: number;
  blocksStart: boolean;
}

/** `null` when nothing needs setup, so callers render no tag. */
export function summarizeNeedsSetup(issues: readonly RunIssue[]): NeedsSetupSummary | null {
  if (issues.length === 0) return null;
  return {
    count: issues.length,
    blocksStart: issues.some((issue) => runIssueEffect(issue) === 'blocks-start'),
  };
}
