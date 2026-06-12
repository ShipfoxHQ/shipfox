import {and, eq, sql} from 'drizzle-orm';
import type {Step} from '#core/entities/step.js';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {createWorkflowRun, getJobsByRunId, getStepsByJobId} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';

// Jobs and steps have no standalone factory — they only exist as children
// materialized from a WorkflowModel by createWorkflowRun. createWorkflowRun
// prepends a synthetic "Set up job" step to every job; this fixture exercises
// step-execution mechanics in isolation, so it strips that step (renumbering the
// user steps back to 0-based) to keep the arrangement focused. The setup step's
// own behavior is covered by materialize / createWorkflowRun / runner tests.
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

  // Drop the synthetic setup step and shift the user steps back to 0-based so the
  // returned arrangement matches what the step-execution tests expect.
  await db().transaction(async (tx) => {
    await tx
      .delete(stepsTable)
      .where(and(eq(stepsTable.jobId, jobId), eq(stepsTable.type, 'setup')));
    await tx
      .update(stepsTable)
      .set({position: sql`${stepsTable.position} - 1`})
      .where(eq(stepsTable.jobId, jobId));
  });

  const steps = await getStepsByJobId(jobId);
  return {jobId, steps};
}
