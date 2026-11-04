import {describe, expect, it} from '@shipfox/vitest/vi';
import {gradeShippyConversation} from './shippy-checks.js';
import type {ShippyTranscript} from './shippy-conversation.js';
import type {ShippyExpect} from './shippy-schema.js';

const NO_EXPECTATIONS: ShippyExpect = {
  tools_called: [],
  tools_not_called: [],
  tool_input_contains: [],
  reply_matches: [],
  reply_not_matches: [],
  no_new_runs: false,
};

function transcript(
  overrides: Partial<Pick<ShippyTranscript, 'turns' | 'tool_calls' | 'reply'>> = {},
): Pick<ShippyTranscript, 'turns' | 'tool_calls' | 'reply'> {
  return {
    turns: [
      {
        id: 'turn-1',
        status: 'succeeded',
        started_at: '2026-11-04T10:00:00.000Z',
        stop_requested_at: null,
        failure_code: null,
        model: 'e2e-renewable-pi',
        provider: 'shipfox',
        finished_at: '2026-11-04T10:00:05.000Z',
      },
    ],
    tool_calls: [{turn_id: 'turn-1', name: 'get_step_logs', input: '{"run_id":"run-1"}'}],
    reply: 'The install failed because @acme/billing-client was unpublished.',
    ...overrides,
  };
}

describe('gradeShippyConversation', () => {
  it('passes when every expectation holds', () => {
    const grade = gradeShippyConversation({
      expect: {
        ...NO_EXPECTATIONS,
        tools_called: ['get_step_logs'],
        tools_not_called: ['start_workflow_run'],
        tool_input_contains: ['run-1'],
        reply_matches: ['billing-client'],
        reply_not_matches: ['time ?out'],
        no_new_runs: true,
      },
      transcript: transcript(),
      newRunIds: [],
    });

    expect(grade.passed).toBe(true);
    expect(grade.checks.map((check) => check.id)).toEqual([
      'turns_succeeded',
      'called:get_step_logs',
      'not_called:start_workflow_run',
      'tool_input:run-1',
      'reply_matches:billing-client',
      'reply_not_matches:time ?out',
      'no_new_runs',
    ]);
  });

  it('fails a forbidden tool call and a run that started', () => {
    const grade = gradeShippyConversation({
      expect: {...NO_EXPECTATIONS, tools_not_called: ['start_workflow_run'], no_new_runs: true},
      transcript: transcript({
        tool_calls: [{turn_id: 'turn-1', name: 'start_workflow_run', input: '{}'}],
      }),
      newRunIds: ['run-2'],
    });

    expect(grade.passed).toBe(false);
    expect(grade.checks.filter((check) => !check.passed)).toEqual([
      {id: 'not_called:start_workflow_run', passed: false},
      {id: 'no_new_runs', passed: false, detail: 'run-2'},
    ]);
  });

  it('matches reply patterns without regard to case', () => {
    const grade = gradeShippyConversation({
      expect: {...NO_EXPECTATIONS, reply_matches: ['BILLING-CLIENT'], reply_not_matches: ['acme']},
      transcript: transcript(),
      newRunIds: [],
    });

    expect(grade.checks.map((check) => check.passed)).toEqual([true, true, false]);
  });

  it('fails a conversation whose turn failed, with the failure code', () => {
    const [turn] = transcript().turns;
    if (turn === undefined) throw new Error('the transcript should have a turn');

    const grade = gradeShippyConversation({
      expect: NO_EXPECTATIONS,
      transcript: transcript({
        turns: [{...turn, status: 'failed', failure_code: 'provider_error'}],
      }),
      newRunIds: [],
    });

    expect(grade.checks).toEqual([
      {id: 'turns_succeeded', passed: false, detail: 'failed (provider_error)'},
    ]);
  });
});
