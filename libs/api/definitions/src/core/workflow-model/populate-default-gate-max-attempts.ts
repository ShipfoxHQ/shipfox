import {gateFailureRules} from '@shipfox/api-definitions-dto';
import {WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS} from '@shipfox/workflow-document';
import type {
  WorkflowModel,
  WorkflowModelStep,
  WorkflowModelStepFailureAction,
} from '../entities/workflow-model.js';

/** Fills the new-run default when a stored model predates the persisted limit. */
export function populateDefaultGateMaxAttempts(model: WorkflowModel): WorkflowModel {
  const jobs = model.jobs;
  if (jobs === undefined) return model;

  let changed = false;
  const populatedJobs = jobs.map((job) => {
    const steps = populateSteps(job.steps);
    if (steps === job.steps) return job;
    changed = true;
    return {...job, steps};
  });

  return changed ? {...model, jobs: populatedJobs} : model;
}

/** Returns `steps` itself when no step changes. */
function populateSteps(steps: readonly WorkflowModelStep[]): readonly WorkflowModelStep[] {
  let changed = false;
  const populated = steps.map((step) => {
    const next = populateStep(step);
    if (next !== step) changed = true;
    return next;
  });
  return changed ? populated : steps;
}

function populateStep(step: WorkflowModelStep): WorkflowModelStep {
  const inner = step.kind === 'composite' ? populateSteps(step.steps) : undefined;
  const withInner =
    step.kind === 'composite' && inner !== undefined && inner !== step.steps
      ? {...step, steps: inner}
      : step;

  const gate = withInner.gate;
  const onFailure = gate?.onFailure;
  if (onFailure === undefined) return withInner;
  if (gateFailureRules(onFailure).every((rule) => rule.maxAttempts !== undefined)) return withInner;

  const populated =
    'restartFrom' in onFailure ? populateRule(onFailure) : onFailure.map(populateRule);
  return {...withInner, gate: {...gate, onFailure: populated}};
}

function populateRule(rule: WorkflowModelStepFailureAction): WorkflowModelStepFailureAction {
  if (rule.maxAttempts !== undefined) return rule;
  return {...rule, maxAttempts: WORKFLOW_GATE_DEFAULT_MAX_ATTEMPTS};
}
