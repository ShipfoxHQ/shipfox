import {WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS} from '@shipfox/workflow-document';
import type {WorkflowModel, WorkflowModelStepFailureAction} from '../entities/workflow-model.js';

/** Fills the new-run default when a stored model predates the persisted limit. */
export function populateDefaultGateMaxAttempts(model: WorkflowModel): WorkflowModel {
  const jobs = model.jobs;
  if (jobs === undefined) return model;

  let changed = false;
  const populatedJobs = jobs.map((job) => {
    let jobChanged = false;
    const steps = job.steps.map((step) => {
      const gate = step.gate;
      const onFailure = gate?.onFailure;
      if (onFailure === undefined) return step;

      const rules = Array.isArray(onFailure) ? onFailure : [onFailure];
      if (rules.every((rule) => rule.maxAttempts !== undefined)) return step;

      const populated = rules.map(populateRule);
      changed = true;
      jobChanged = true;
      return {
        ...step,
        gate: {...gate, onFailure: Array.isArray(onFailure) ? populated : populated[0]},
      };
    });

    return jobChanged ? {...job, steps} : job;
  });

  return changed ? {...model, jobs: populatedJobs} : model;
}

function populateRule(rule: WorkflowModelStepFailureAction): WorkflowModelStepFailureAction {
  if (rule.maxAttempts !== undefined) return rule;
  return {...rule, maxAttempts: WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS};
}
