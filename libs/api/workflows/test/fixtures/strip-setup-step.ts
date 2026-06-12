import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';

// createWorkflowRun prepends a synthetic "Set up job" step to every job. Tests that
// exercise step-execution mechanics in isolation strip it and renumber the user
// steps back to 0-based, so their arrangement matches the steps they declared.
export async function stripSetupStep(jobId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx
      .delete(stepsTable)
      .where(and(eq(stepsTable.jobId, jobId), eq(stepsTable.type, 'setup')));
    await tx
      .update(stepsTable)
      .set({position: sql`${stepsTable.position} - 1`})
      .where(eq(stepsTable.jobId, jobId));
  });
}
