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

  for (const sourceKey of Object.keys(document.jobs)) {
    const id = stableId(sourceKey);
    const existingSourceKey = usedJobIds.get(id);
    if (existingSourceKey !== undefined) {
      issues.push(
        issue({
          code: 'duplicate-job-id',
          message: `Job keys "${existingSourceKey}" and "${sourceKey}" resolve to the same stable id "${id}".`,
          path: ['jobs', sourceKey],
          details: {id, sourceKeys: [existingSourceKey, sourceKey]},
        }),
      );
      continue;
    }

    usedJobIds.set(id, sourceKey);
    jobIdBySourceName.set(sourceKey, id);
  }

  return jobIdBySourceName;
}
