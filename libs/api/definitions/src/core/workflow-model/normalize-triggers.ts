import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {WorkflowModelTrigger} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {stableId} from './stable-id.js';
import {issue} from './validation-issue.js';

const manualTriggerSource = 'manual';

export function normalizeTriggers(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelTrigger[] {
  const triggers = document.triggers ?? {};
  const manualTriggerNames = Object.entries(triggers)
    .filter(([, trigger]) => trigger.source === manualTriggerSource)
    .map(([sourceName]) => sourceName);
  const usedTriggerIds = new Map<string, string>();

  if (manualTriggerNames.length > 1) {
    issues.push(
      issue({
        code: 'multiple-manual-triggers',
        message: `A workflow may declare at most one manual trigger; found ${manualTriggerNames.length}: ${manualTriggerNames.join(', ')}.`,
        path: ['triggers'],
        details: {manualTriggerNames},
      }),
    );
  }

  return Object.entries(triggers).flatMap(([sourceName, trigger]) => {
    const id = stableId(sourceName);
    const existingSourceName = usedTriggerIds.get(id);
    if (existingSourceName !== undefined) {
      issues.push(
        issue({
          code: 'duplicate-trigger-id',
          message: `Trigger names "${existingSourceName}" and "${sourceName}" resolve to the same stable id "${id}".`,
          path: ['triggers', sourceName],
          details: {id, sourceNames: [existingSourceName, sourceName]},
        }),
      );
      return [];
    }
    usedTriggerIds.set(id, sourceName);

    return [
      {
        id,
        sourceName,
        source: trigger.source,
        event: trigger.event,
        ...(trigger.with === undefined ? {} : {inputs: trigger.with}),
        ...(trigger.filter === undefined ? {} : {filter: trigger.filter}),
      },
    ];
  });
}
