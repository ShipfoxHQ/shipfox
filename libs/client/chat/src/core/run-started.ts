import type {PairedAction} from '@shipfox/client-logs';

export const START_WORKFLOW_RUN_TOOL = 'start_workflow_run';

export interface RunStarted {
  runId: string;
  /** What the run is called, which is the workflow's name unless it set a run name. */
  name: string;
  number: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads a started run from a settled `start_workflow_run` call. The stored result is wrapped as
 * untrusted data, so the JSON is cut out of the wrapper, and a result that doesn't read as a run
 * stays an ordinary tool row.
 */
export function readRunStarted(action: PairedAction): RunStarted | undefined {
  if (action.request?.name !== START_WORKFLOW_RUN_TOOL) return undefined;
  if (action.state !== 'succeeded' || !action.result) return undefined;
  const output = action.result.output;
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end < start) return undefined;
  try {
    const result: unknown = JSON.parse(output.slice(start, end + 1));
    if (typeof result !== 'object' || result === null) return undefined;
    const {run_id: runId, run_number: number, name} = result as Record<string, unknown>;
    if (typeof runId !== 'string' || !UUID.test(runId)) return undefined;
    if (typeof number !== 'number' || !Number.isInteger(number)) return undefined;
    return {runId, number, name: typeof name === 'string' ? name : ''};
  } catch {
    return undefined;
  }
}
