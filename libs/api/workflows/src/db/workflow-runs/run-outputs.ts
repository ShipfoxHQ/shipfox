import {readPersistedWorkflowModel} from '@shipfox/api-definitions-dto';
import {classifyOutputFailure, type OutputFailure} from '#core/output-failure.js';
import {
  assembleWorkflowOutputsContext,
  materializeWorkflowOutputs,
} from '#core/step-config/index.js';
import type {Tx} from '../db.js';
import type {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, type workflowRuns} from '../schema/workflow-runs.js';
import {getRunAttemptJobContexts} from './jobs.js';

export type RunAttemptOutputsResult =
  | {kind: 'none'}
  | {kind: 'materialized'; outputs: Record<string, unknown>}
  | ({kind: 'failed'} & OutputFailure);

/**
 * Evaluates the workflow outputs of a succeeding attempt from workflows-owned
 * rows only: the attempt's jobs, its vars snapshot, and the run's inputs and
 * trigger payload. Carried-over jobs keep their outputs, so reruns can use them.
 */
export async function materializeRunAttemptOutputs(
  tx: Tx,
  params: {
    run: typeof workflowRuns.$inferSelect;
    attempt: typeof workflowRunAttempts.$inferSelect;
  },
): Promise<RunAttemptOutputsResult> {
  const model =
    params.attempt.model === null ? null : readPersistedWorkflowModel(params.attempt.model);
  if (!model || model.outputs === undefined) return {kind: 'none'};

  const run = toWorkflowRun(params.run);
  // No row locks needed: a run only succeeds once every job is terminal, and terminal jobs
  // never change status or outputs.
  const jobs = await getRunAttemptJobContexts(tx, {workflowRunAttemptId: params.attempt.id, model});
  try {
    const outputs = materializeWorkflowOutputs({
      model,
      context: assembleWorkflowOutputsContext({
        run: {...run, currentAttempt: params.attempt.attempt},
        triggerPayload: run.triggerPayload,
        inputs: run.inputs,
        vars: params.attempt.vars ?? undefined,
        jobs,
      }),
      definitionId: run.definitionId,
    });
    return outputs === null ? {kind: 'none'} : {kind: 'materialized', outputs};
  } catch (error) {
    const failure = classifyOutputFailure(error, 'workflow.outputs');
    if (failure === null) throw error;
    return {kind: 'failed', ...failure};
  }
}
