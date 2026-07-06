import type {EvaluationTraceRowEntryDto} from '@shipfox/api-workflows-dto';
import {nodeConditionSummary} from './condition-trace.js';

describe('nodeConditionSummary', () => {
  it('summarizes an explicit step condition and its result', () => {
    const trace: EvaluationTraceRowEntryDto[] = [
      {
        field: 'step.if',
        expression: "steps.test.status == 'failed'",
        roots: ['steps'],
        fill_target: 'step-dispatch',
        evaluated_at: 'step-dispatch',
        value: 'false',
      },
    ];

    const summary = nodeConditionSummary(trace, 'step');

    expect(summary).toEqual({
      expression: "steps.test.status == 'failed'",
      value: 'false',
      isDefaultGate: false,
      errored: false,
    });
  });

  it('flags the implicit default gate', () => {
    const trace: EvaluationTraceRowEntryDto[] = [
      {
        field: 'step.default_gate',
        expression: '!execution.failed',
        roots: ['execution'],
        fill_target: 'step-dispatch',
        evaluated_at: 'step-dispatch',
        value: 'false',
      },
    ];

    const summary = nodeConditionSummary(trace, 'step');

    expect(summary?.isDefaultGate).toBe(true);
  });

  it('marks a degraded (errored) predicate', () => {
    const trace: EvaluationTraceRowEntryDto[] = [
      {
        field: 'job.if',
        expression: 'jobs.build.outputs.redy',
        roots: ['jobs'],
        fill_target: 'job-activation',
        evaluated_at: 'job-activation',
        degraded: true,
      },
    ];

    const summary = nodeConditionSummary(trace, 'job');

    expect(summary).toMatchObject({errored: true, value: null});
  });

  it('ignores entries for the other node level and non-condition fields', () => {
    const trace: EvaluationTraceRowEntryDto[] = [
      {
        field: 'step.if',
        expression: "steps.a.status == 'succeeded'",
        roots: ['steps'],
        fill_target: 'step-dispatch',
        evaluated_at: 'step-dispatch',
        value: 'true',
      },
    ];

    expect(nodeConditionSummary(trace, 'job')).toBeNull();
    expect(nodeConditionSummary(null, 'step')).toBeNull();
  });
});
