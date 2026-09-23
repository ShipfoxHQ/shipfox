import type {EvaluationTraceEntry} from './workflow-run.js';

export function splitJobEvaluationTrace(trace: readonly EvaluationTraceEntry[]): {
  conditionTrace: EvaluationTraceEntry[];
  executionNameTrace: EvaluationTraceEntry[];
} {
  const conditionTrace: EvaluationTraceEntry[] = [];
  const executionNameTrace: EvaluationTraceEntry[] = [];

  for (const entry of trace) {
    if (!('dropped' in entry) && entry.field === 'job.execution_name') {
      executionNameTrace.push(entry);
    } else {
      conditionTrace.push(entry);
    }
  }

  return {conditionTrace, executionNameTrace};
}
