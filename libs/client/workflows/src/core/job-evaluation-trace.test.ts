import {splitJobEvaluationTrace} from './job-evaluation-trace.js';
import type {EvaluationTraceEntry} from './workflow-run.js';

test('separates execution-name evaluation from the job condition trace', () => {
  const executionName = {
    field: 'job.execution_name',
    result: 'build',
  } as unknown as EvaluationTraceEntry;
  const condition = {field: 'job.condition', result: true} as unknown as EvaluationTraceEntry;

  expect(splitJobEvaluationTrace([executionName, condition])).toEqual({
    conditionTrace: [condition],
    executionNameTrace: [executionName],
  });
});
