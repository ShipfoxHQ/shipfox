import type {JobId, StepId, TriggerId, WorkflowId} from './workflow-ir.js';

const fallbackId = 'item';

export function createWorkflowId(name: string): WorkflowId {
  return slugifyIdPart(name);
}

export function createTriggerId(triggerName: string): TriggerId {
  return slugifyIdPart(triggerName);
}

export function createJobId(jobName: string): JobId {
  return slugifyIdPart(jobName);
}

export function createStepId(params: {
  jobId: JobId;
  stepName?: string | undefined;
  run: string;
  usedStepIds: ReadonlySet<StepId>;
}): StepId {
  const source = params.stepName ?? params.run;
  const base = `${params.jobId}.${slugifyIdPart(source)}`;
  return createUniqueId(base, params.usedStepIds);
}

export function createUniqueId(base: string, usedIds: ReadonlySet<string>): string {
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function slugifyIdPart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallbackId;
}
