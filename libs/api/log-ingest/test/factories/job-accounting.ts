import {Factory} from 'fishery';
import {db} from '#db/db.js';
import {jobAccounting} from '#db/schema/job-accounting.js';

interface JobAccountingAttrs {
  jobId: string;
  workspaceId: string;
  payloadBytesUsed: number;
  startedAt: Date;
  cappedAt: Date | null;
}

// Arranges a pre-existing accounting row so a test can control the budget clock
// origin (`startedAt`) or pre-cap a job. `appendLogs` creates the row with
// `INSERT ... ON CONFLICT DO NOTHING`, so a pre-arranged row is preserved.
export const jobAccountingFactory = Factory.define<JobAccountingAttrs>(({onCreate}) => {
  onCreate(async (attrs) => {
    await db()
      .insert(jobAccounting)
      .values({
        jobId: attrs.jobId,
        workspaceId: attrs.workspaceId,
        payloadBytesUsed: attrs.payloadBytesUsed,
        startedAt: attrs.startedAt,
        cappedAt: attrs.cappedAt,
      })
      .onConflictDoNothing({target: jobAccounting.jobId});
    return attrs;
  });

  return {
    jobId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    payloadBytesUsed: 0,
    startedAt: new Date(),
    cappedAt: null,
  };
});
