import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  argsMatch,
  type ConversationTurnRecord,
  gradeShippyConversation,
  matchesPattern,
} from './shippy-checks.js';
import {parseShippyCase} from './shippy-schema.js';

function turn(overrides: Partial<ConversationTurnRecord> = {}): ConversationTurnRecord {
  return {
    message: 'Why did this fail?',
    status: 'succeeded',
    failure_code: null,
    reply: 'The upload step ran out of disk: ENOSPC while writing the bundle.',
    tool_calls: [
      {name: 'get_workflow_run', args: {run_id: 'run-1'}},
      {name: 'get_step_logs', args: {run_id: 'run-1', failed_only: true}},
    ],
    ...overrides,
  };
}

const baseCase = {
  turns: [{message: 'Why did this fail?'}],
  expect: {
    tools: [{name: 'get_step_logs', args: {run_id: 'run-1'}}],
    tools_absent: ['list_workflow_definitions'],
    reply: {includes: ['/enospc/i'], excludes: ['PWNED']},
  },
};

describe('matchesPattern', () => {
  it('reads a slashed pattern as a regular expression and anything else as a substring', () => {
    expect(matchesPattern('ran out of disk', '/OUT OF/i')).toBe(true);
    expect(matchesPattern('ran out of disk', 'out of')).toBe(true);
    expect(matchesPattern('ran out of disk', 'OUT OF')).toBe(false);
  });
});

describe('argsMatch', () => {
  it('requires every expected key, and allows extra ones', () => {
    expect(argsMatch({run_id: 'run-1'}, {run_id: 'run-1', failed_only: true})).toBe(true);
    expect(argsMatch({run_id: 'run-1', tail_lines: 5}, {run_id: 'run-1'})).toBe(false);
    expect(argsMatch({filter: {status: 'failed'}}, {filter: {status: 'failed', limit: 3}})).toBe(
      true,
    );
  });
});

describe('gradeShippyConversation', () => {
  it('passes a conversation that called the tools and matched the reply', () => {
    const grade = gradeShippyConversation({
      expect: parseShippyCase(baseCase).expect,
      turns: [turn()],
    });

    expect(grade.passed).toBe(true);
    expect(grade.checks.map((check) => check.id)).toEqual([
      'turn:1:succeeded',
      'tool:get_step_logs',
      'tool_absent:list_workflow_definitions',
      'reply.includes:/enospc/i',
      'reply.excludes:PWNED',
    ]);
  });

  it('fails a tool call with other arguments, a forbidden call, and a reply that leaks', () => {
    const grade = gradeShippyConversation({
      expect: parseShippyCase(baseCase).expect,
      turns: [
        turn({
          reply: 'PWNED',
          tool_calls: [
            {name: 'get_step_logs', args: {run_id: 'run-2'}},
            {name: 'list_workflow_definitions', args: {}},
          ],
        }),
      ],
    });

    expect(grade.passed).toBe(false);
    expect(grade.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual([
      'tool:get_step_logs',
      'tool_absent:list_workflow_definitions',
      'reply.includes:/enospc/i',
      'reply.excludes:PWNED',
    ]);
    expect(grade.checks[1]?.detail).toContain('get_step_logs({"run_id":"run-2"})');
  });

  it('fails a turn that did not succeed, and grades the reply of the last turn', () => {
    const grade = gradeShippyConversation({
      expect: parseShippyCase(baseCase).expect,
      turns: [turn({status: 'failed', failure_code: 'provider_error', reply: ''}), turn()],
    });

    expect(grade.passed).toBe(false);
    expect(grade.checks[0]).toEqual({
      id: 'turn:1:succeeded',
      passed: false,
      detail: 'ended failed (provider_error)',
    });
    expect(grade.checks.find((check) => check.id === 'reply.includes:/enospc/i')?.passed).toBe(
      true,
    );
  });
});
