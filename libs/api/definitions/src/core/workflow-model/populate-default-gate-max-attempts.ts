import {WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS} from '@shipfox/workflow-document';
import type {WorkflowModel} from '../entities/workflow-model.js';

/** Fills the new-run default when a stored model predates the persisted limit. */
export function populateDefaultGateMaxAttempts(model: WorkflowModel): WorkflowModel {
  const jobs = model.jobs;
  if (jobs === undefined) return model;

  let changed = false;
  const populatedJobs = jobs.map((job) => {
    let jobChanged = false;
    const steps = job.steps.map((step) => {
      const gate = step.gate;
      if (gate?.onFailure === undefined || gate.onFailure.maxAttempts !== undefined) return step;

      changed = true;
      jobChanged = true;
      return {
        ...step,
        gate: {
          ...gate,
          onFailure: {
            ...gate.onFailure,
            maxAttempts: WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS,
          },
        },
      };
    });

    return jobChanged ? {...job, steps} : job;
  });

  return changed ? {...model, jobs: populatedJobs} : model;
}
