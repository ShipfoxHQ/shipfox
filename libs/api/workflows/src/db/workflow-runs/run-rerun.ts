import {WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED} from '@shipfox/api-workflows-dto';
import {and, asc, eq, inArray, sql} from 'drizzle-orm';
import {isWorkflowRunTerminal, type WorkflowRun} from '#core/entities/workflow-run.js';
import {NoFailedJobsError, RunNotTerminalError, SourceRunNotFoundError} from '#core/errors.js';
import {assembleExecutionCreationContext} from '#core/step-config/assemble-run-context.js';
import {materializeJobRunner} from '#core/step-config/materialize-workflow-model.js';
import {recordWorkflowRunCreated} from '#metrics/instance.js';
import {db} from '../db.js';
import {writeWorkflowsOutboxEvent} from '../outbox-writes.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {lockWorkflowRun} from './shared.js';

export interface CreateRerunWorkflowRunParams {
  workflowRunId: string;
  mode: 'all' | 'failed';
  actorUserId: string;
}

export async function createRerunWorkflowRun(
  params: CreateRerunWorkflowRunParams,
): Promise<WorkflowRun> {
  const result = await db().transaction(async (tx) => {
    const workflowRunId = params.workflowRunId;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workflowRunId}))`);

    const sourceRow = await lockWorkflowRun(workflowRunId, tx);
    if (!sourceRow) throw new SourceRunNotFoundError(workflowRunId);

    const [sourceAttemptRow] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(
        and(
          eq(workflowRunAttempts.workflowRunId, sourceRow.id),
          eq(workflowRunAttempts.attempt, sourceRow.currentAttempt),
        ),
      )
      .limit(1)
      .for('update');
    if (!sourceAttemptRow) {
      throw new Error(
        `Current attempt ${sourceRow.currentAttempt} missing for run ${sourceRow.id}`,
      );
    }
    if (!isWorkflowRunTerminal(sourceAttemptRow.status)) {
      throw new RunNotTerminalError(sourceRow.id);
    }

    const sourceJobs = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.workflowRunAttemptId, sourceAttemptRow.id))
      .orderBy(asc(jobs.position), asc(jobs.id));

    if (
      params.mode === 'failed' &&
      !sourceJobs.some((job) => job.status === 'failed' || job.status === 'cancelled')
    ) {
      throw new NoFailedJobsError(sourceRow.id);
    }

    const [attemptRow] = await tx
      .select({value: sql<number>`coalesce(max(${workflowRunAttempts.attempt}), 1)`})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.workflowRunId, sourceRow.id));
    const attempt = Number(attemptRow?.value ?? 1) + 1;

    const [newAttemptRow] = await tx
      .insert(workflowRunAttempts)
      .values({
        workflowRunId: sourceRow.id,
        attempt,
        status: 'pending',
        rerunMode: params.mode,
        rerunByUserId: params.actorUserId,
        model: sourceAttemptRow.model,
      })
      .returning();
    if (!newAttemptRow) throw new Error('Insert returned no rows');

    const sourceJobIds = sourceJobs.map((job) => job.id);
    const sourceJobExecutionRows =
      sourceJobIds.length === 0
        ? []
        : await tx
            .select()
            .from(jobExecutions)
            .where(inArray(jobExecutions.jobId, sourceJobIds))
            .orderBy(asc(jobExecutions.jobId), asc(jobExecutions.sequence), asc(jobExecutions.id));
    const sourceJobExecutionByJobId = new Map<string, (typeof sourceJobExecutionRows)[number]>();
    for (const jobExecution of sourceJobExecutionRows) {
      if (!sourceJobExecutionByJobId.has(jobExecution.jobId)) {
        sourceJobExecutionByJobId.set(jobExecution.jobId, jobExecution);
      }
    }
    const sourceJobExecutionIds = [...sourceJobExecutionByJobId.values()].map(
      (jobExecution) => jobExecution.id,
    );
    const sourceSteps =
      sourceJobExecutionIds.length === 0
        ? []
        : await tx
            .select()
            .from(steps)
            .where(inArray(steps.jobExecutionId, sourceJobExecutionIds))
            .orderBy(asc(steps.jobExecutionId), asc(steps.position), asc(steps.id));

    const clonedJobRows =
      sourceJobs.length === 0
        ? []
        : await tx
            .insert(jobs)
            .values(
              sourceJobs.map((job) => {
                const carriedOver = params.mode === 'failed' && job.status === 'succeeded';
                return {
                  workflowRunAttemptId: newAttemptRow.id,
                  key: job.key,
                  name: job.name,
                  mode: job.mode,
                  status: carriedOver ? ('succeeded' as const) : ('pending' as const),
                  statusReason: null,
                  carriedOver,
                  checkoutPersistCredentials: job.checkoutPersistCredentials,
                  checkoutPermissionsContents: job.checkoutPermissionsContents,
                  success: job.success,
                  executionTimeoutMs: job.executionTimeoutMs,
                  listeningTimeoutMs: job.listeningTimeoutMs,
                  maxExecutions: job.maxExecutions,
                  onResolve: job.onResolve,
                  batchDebounceMs: job.batchDebounceMs,
                  batchMaxSize: job.batchMaxSize,
                  batchMaxWaitMs: job.batchMaxWaitMs,
                  listenerStatus: 'inactive' as const,
                  resolutionReason: null,
                  listeningOn: job.listeningOn ? [...job.listeningOn] : null,
                  listeningUntil: job.listeningUntil ? [...job.listeningUntil] : null,
                  outputs: carriedOver && job.outputs ? {...job.outputs} : null,
                  dependencies: [...job.dependencies],
                  runner: job.runner ? [...job.runner] : null,
                  position: job.position,
                };
              }),
            )
            .returning();

    const sourceJobByPosition = new Map(sourceJobs.map((job) => [job.position, job]));
    const sourceModelJobByKey = new Map(
      (sourceAttemptRow.model?.jobs ?? []).map((job) => [job.key, job]),
    );
    const clonedJobExecutionValues = clonedJobRows.flatMap((job) => {
      const carriedOver = params.mode === 'failed' && job.status === 'succeeded';
      const sourceJob = sourceJobByPosition.get(job.position);
      const sourceExecution = sourceJob ? sourceJobExecutionByJobId.get(sourceJob.id) : undefined;
      const modelJob = sourceModelJobByKey.get(job.key);
      const executionName = sourceExecution?.name ?? `${job.key} #1`;
      const runner =
        carriedOver || modelJob === undefined
          ? (sourceExecution?.runner ?? job.runner ?? null)
          : materializeJobRunner({
              job: modelJob,
              context: assembleExecutionCreationContext({
                run: toWorkflowRun(sourceRow),
                triggerPayload: sourceRow.triggerPayload,
                inputs: sourceRow.inputs,
                jobId: job.id,
                sequence: 1,
                executionName,
                status: 'pending',
                triggerEvents: [],
                priorExecutions: [],
              }),
              definitionId: sourceRow.definitionId,
            });
      return job.mode === 'listening'
        ? []
        : [
            {
              jobId: job.id,
              sequence: 1,
              name: executionName,
              runner: runner ? [...runner] : null,
              status: carriedOver ? ('succeeded' as const) : ('pending' as const),
              statusReason: null,
              outputs:
                carriedOver && sourceExecution?.outputs ? {...sourceExecution.outputs} : null,
              ...(carriedOver ? {finishedAt: sql`now()`} : {}),
            },
          ];
    });
    const clonedJobExecutionRows =
      clonedJobExecutionValues.length === 0
        ? []
        : await tx.insert(jobExecutions).values(clonedJobExecutionValues).returning();

    const sourceJobById = new Map(sourceJobs.map((job) => [job.id, job]));
    const sourceJobByJobExecutionId = new Map(
      [...sourceJobExecutionByJobId.entries()].flatMap(([jobId, jobExecution]) => {
        const job = sourceJobById.get(jobId);
        return job ? [[jobExecution.id, job] as const] : [];
      }),
    );
    const clonedJobByPosition = new Map(clonedJobRows.map((job) => [job.position, job]));
    const clonedJobExecutionByJobId = new Map(
      clonedJobExecutionRows.map((jobExecution) => [jobExecution.jobId, jobExecution]),
    );
    const stepValues = sourceSteps.flatMap((step) => {
      const sourceJob = sourceJobByJobExecutionId.get(step.jobExecutionId);
      if (!sourceJob) return [];
      const clonedJob = clonedJobByPosition.get(sourceJob.position);
      if (!clonedJob) return [];
      const clonedJobExecution = clonedJobExecutionByJobId.get(clonedJob.id);
      if (!clonedJobExecution) return [];
      const carriedOver = params.mode === 'failed' && sourceJob.status === 'succeeded';
      return [
        {
          jobExecutionId: clonedJobExecution.id,
          key: step.key,
          name: step.name,
          sourceLocation: step.sourceLocation,
          status: carriedOver ? step.status : ('pending' as const),
          statusReason: carriedOver ? step.statusReason : null,
          type: step.type,
          config: step.config,
          condition: step.condition ?? null,
          configPlan: step.configPlan,
          authoredConfig: step.authoredConfig,
          error: null,
          position: step.position,
          currentAttempt: 1,
        },
      ];
    });

    if (stepValues.length > 0) {
      await tx.insert(steps).values(stepValues);
    }

    const [newRunRow] = await tx
      .update(workflowRuns)
      .set({
        currentAttempt: attempt,
        status: 'pending',
        version: sql`${workflowRuns.version} + 1`,
        updatedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      })
      .where(eq(workflowRuns.id, sourceRow.id))
      .returning();
    if (!newRunRow) throw new Error(`Workflow run missing after rerun: ${sourceRow.id}`);

    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
      payload: {
        workflowRunId: newRunRow.id,
        workflowRunAttemptId: newAttemptRow.id,
        attempt: newAttemptRow.attempt,
        workspaceId: newRunRow.workspaceId,
        projectId: newRunRow.projectId,
        definitionId: newRunRow.definitionId,
      },
    });

    return toWorkflowRun(newRunRow);
  });

  recordWorkflowRunCreated(result.triggerPayload.provider ?? result.triggerSource);

  return result;
}
