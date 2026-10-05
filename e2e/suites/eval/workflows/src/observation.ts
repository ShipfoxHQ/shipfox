import {observeRun, type WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {parse as parseYaml} from 'yaml';

function stepKeysOf(yaml: string): string[] {
  const document = parseYaml(yaml) as {jobs?: Record<string, {steps?: Array<{key?: string}>}>};
  return Object.values(document.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.key === undefined ? [] : [step.key])),
  );
}

/** The run with every job's executions and steps, so the result shows what happened. */
export async function observeWholeRun({
  runId,
  token,
  yaml,
}: {
  runId: string;
  token: string;
  yaml: string;
}): Promise<WorkflowRunObservation> {
  const overview = await observeRun({runId, token});
  const stepKeys = stepKeysOf(yaml);
  return await observeRun({
    runId,
    token,
    selection: {
      jobs: overview.jobs.map((job) => ({
        jobKey: job.key,
        includeDefaultExecution: true,
        executionSequences: 'all',
        includeContext: true,
        stepKeys,
      })),
    },
  });
}
