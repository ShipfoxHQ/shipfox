import type {WorkflowDocument} from '@shipfox/workflow-document';
import type {
  WorkflowModelListeningTrigger,
  WorkflowModelTrigger,
} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {stableId} from './stable-id.js';
import {issue} from './validation-issue.js';

const manualTriggerSource = 'manual';

export function normalizeTriggers(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
): readonly WorkflowModelTrigger[] {
  const triggers = document.triggers ?? {};
  const manualTriggerKeys = Object.entries(triggers)
    .filter(([, trigger]) => trigger.source === manualTriggerSource)
    .map(([sourceKey]) => sourceKey);
  const usedTriggerIds = new Map<string, string>();

  if (manualTriggerKeys.length > 1) {
    issues.push(
      issue({
        code: 'multiple-manual-triggers',
        message: `A workflow may declare at most one manual trigger; found ${manualTriggerKeys.length}: ${manualTriggerKeys.join(', ')}.`,
        path: ['triggers'],
        details: {manualTriggerKeys},
      }),
    );
  }

  return Object.entries(triggers).flatMap(([sourceKey, trigger]) => {
    const id = stableId(sourceKey);
    const existingSourceKey = usedTriggerIds.get(id);
    if (existingSourceKey !== undefined) {
      issues.push(
        issue({
          code: 'duplicate-trigger-id',
          message: `Trigger keys "${existingSourceKey}" and "${sourceKey}" resolve to the same stable id "${id}".`,
          path: ['triggers', sourceKey],
          details: {id, sourceKeys: [existingSourceKey, sourceKey]},
        }),
      );
      return [];
    }
    usedTriggerIds.set(id, sourceKey);

    return [
      {
        id,
        key: sourceKey,
        ...normalizeTriggerEntry(trigger),
      },
    ];
  });
}

export function normalizeTriggerEntry(trigger: {
  readonly source: string;
  readonly event: string;
  readonly with?: Readonly<Record<string, unknown>> | undefined;
  readonly filter?: string | undefined;
}): WorkflowModelListeningTrigger {
  return {
    source: trigger.source,
    event: trigger.event,
    ...(trigger.with === undefined ? {} : {inputs: trigger.with}),
    ...(trigger.filter === undefined ? {} : {filter: trigger.filter}),
  };
}
