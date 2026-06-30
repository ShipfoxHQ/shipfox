import {eq} from 'drizzle-orm';
import {Factory} from 'fishery';
import type {Job, JobStatus} from '#core/entities/job.js';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {getJobsByRunId} from '#db/workflow-runs.js';
import {workflowRunFactory} from './workflow-run.js';

interface JobTransientParams {
  projectId?: string;
  status?: JobStatus;
}

// Provisions a workflow run for `projectId` and returns its first job moved to
// `status` (default 'running'). A job cannot exist without its run (run_id is a
// NOT NULL FK), so this factory creates the enclosing run too. 'running' is the
// realistic precondition for the lease-authed checkout path: a runner only holds
// a lease for a job it has claimed and is executing. The returned Job carries
// `runId`, so tests that need the run id read it straight off the job.
export const jobFactory = Factory.define<Job, JobTransientParams>(({transientParams, onCreate}) => {
  onCreate(async () => {
    const {projectId = crypto.randomUUID(), status = 'running'} = transientParams;
    const run = await workflowRunFactory.create({projectId});
    const [job] = await getJobsByRunId(run.id);
    if (!job) throw new Error('jobFactory: run created no jobs');
    await db().update(jobs).set({status}).where(eq(jobs.id, job.id));
    return {...job, status, statusReason: null, carriedOver: false};
  });

  return {
    id: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    name: 'build',
    status: 'running',
    statusReason: null,
    carriedOver: false,
    dependencies: [],
    runner: null,
    position: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    timedOutAt: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
  };
});
