import {and, eq, inArray, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {getStepsByJobId} from '#db/workflow-runs.js';

// createWorkflowRun prepends a synthetic "Set up job" step to every job. Tests that
// exercise step-execution mechanics in isolation strip it and renumber the user
// steps back to 0-based, so their arrangement matches the steps they declared.
export async function stripSetupStep(jobId: string): Promise<void> {
  const jobSteps = await getStepsByJobId(jobId);
  const stepIds = jobSteps.map((step) => step.id);
  if (stepIds.length === 0) return;

  await db().transaction(async (tx) => {
    await tx
      .delete(stepsTable)
      .where(and(inArray(stepsTable.id, stepIds), eq(stepsTable.type, 'setup')));
    await tx
      .update(stepsTable)
      .set({position: sql`${stepsTable.position} - 1`})
      .where(inArray(stepsTable.id, stepIds));
  });
}
