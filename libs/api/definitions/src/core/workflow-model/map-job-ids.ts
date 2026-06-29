import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {stableId} from './stable-id.js';
import {issue} from './validation-issue.js';

export function mapJobIds(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
): ReadonlyMap<string, string> {
  const jobIdBySourceName = new Map<string, string>();
  const usedJobIds = new Map<string, string>();

  for (const sourceName of Object.keys(document.jobs)) {
    const id = stableId(sourceName);
    const existingSourceName = usedJobIds.get(id);
    if (existingSourceName !== undefined) {
      issues.push(
        issue({
          code: 'duplicate-job-id',
          message: `Job names "${existingSourceName}" and "${sourceName}" resolve to the same stable id "${id}".`,
          path: ['jobs', sourceName],
          details: {id, sourceNames: [existingSourceName, sourceName]},
        }),
      );
      continue;
    }

    usedJobIds.set(id, sourceName);
    jobIdBySourceName.set(sourceName, id);
  }

  return jobIdBySourceName;
}
