import type {Step} from '#core/entities/step.js';
import {createWorkflowRun, getJobsByRunId, getStepsByJobId} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';

// Jobs/steps are materialized from a WorkflowModel by createWorkflowRun (there is
// no step/job factory), so arrange a single `build` job with `stepCount` steps
// and read back its persisted, position-ordered steps.
export async function arrangeJobWithSteps(
  stepCount: number,
): Promise<{jobId: string; steps: Step[]}> {
  const model = workflowModel({
    name: 'Test Workflow',
    jobs: {
      build: {steps: Array.from({length: stepCount}, (_, i) => ({run: `echo step-${i}`}))},
    },
  });

  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model,
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });

  const jobs = await getJobsByRunId(run.id);
  const jobId = jobs[0]?.id as string;
  const steps = await getStepsByJobId(jobId);
  return {jobId, steps};
}
