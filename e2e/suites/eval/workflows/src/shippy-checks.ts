import type {ShippyTranscript} from './shippy-conversation.js';
import type {ShippyExpect} from './shippy-schema.js';

export interface ShippyCheck {
  id: string;
  passed: boolean;
  /** Why the check failed, or what it looked at. */
  detail?: string;
}

export interface ShippyGrade {
  checks: ShippyCheck[];
  passed: boolean;
}

/**
 * Grades one conversation against the case's `expect`. Every turn must succeed first, because a
 * failed turn says nothing about Shippy's judgment. `$runs.<name>` references are resolved
 * before this runs.
 */
export function gradeShippyConversation(params: {
  expect: ShippyExpect;
  transcript: Pick<ShippyTranscript, 'turns' | 'tool_calls' | 'reply'>;
  /** Runs that started in the project while the conversation ran. */
  newRunIds: readonly string[];
}): ShippyGrade {
  const {expect, transcript} = params;
  const checks: ShippyCheck[] = [
    turnsSucceeded(transcript.turns),
    ...toolChecks({expect, toolCalls: transcript.tool_calls}),
    ...replyChecks({expect, reply: transcript.reply}),
  ];
  if (expect.no_new_runs) {
    checks.push(
      check({id: 'no_new_runs', passed: params.newRunIds.length === 0}, () =>
        params.newRunIds.join(', '),
      ),
    );
  }
  return {checks, passed: checks.every((entry) => entry.passed)};
}

function toolChecks(params: {
  expect: ShippyExpect;
  toolCalls: ShippyTranscript['tool_calls'];
}): ShippyCheck[] {
  const called = new Set(params.toolCalls.map((call) => call.name));
  return [
    ...params.expect.tools_called.map((tool) =>
      check(
        {id: `called:${tool}`, passed: called.has(tool)},
        () => `Called: ${listOrNone([...called])}`,
      ),
    ),
    ...params.expect.tools_not_called.map((tool) => ({
      id: `not_called:${tool}`,
      passed: !called.has(tool),
    })),
    ...params.expect.tool_input_contains.map((text) =>
      check(
        {
          id: `tool_input:${text}`,
          passed: params.toolCalls.some((call) => call.input.includes(text)),
        },
        () => `Inputs: ${listOrNone(params.toolCalls.map(callLabel))}`,
      ),
    ),
  ];
}

function replyChecks(params: {expect: ShippyExpect; reply: string}): ShippyCheck[] {
  const matches = (pattern: string) => new RegExp(pattern, 'iu').test(params.reply);
  return [
    ...params.expect.reply_matches.map((pattern) =>
      check({id: `reply_matches:${pattern}`, passed: matches(pattern)}, () =>
        excerpt(params.reply),
      ),
    ),
    ...params.expect.reply_not_matches.map((pattern) =>
      check({id: `reply_not_matches:${pattern}`, passed: !matches(pattern)}, () =>
        excerpt(params.reply),
      ),
    ),
  ];
}

/** A check, with the detail only when it failed. */
function check(params: {id: string; passed: boolean}, detail: () => string): ShippyCheck {
  return params.passed ? params : {...params, detail: detail()};
}

function turnsSucceeded(turns: ShippyTranscript['turns']): ShippyCheck {
  const failed = turns.filter((turn) => turn.status !== 'succeeded');
  if (failed.length === 0) return {id: 'turns_succeeded', passed: true};
  return {
    id: 'turns_succeeded',
    passed: false,
    detail: failed
      .map((turn) => `${turn.status}${turn.failure_code ? ` (${turn.failure_code})` : ''}`)
      .join(', '),
  };
}

function callLabel(call: ShippyTranscript['tool_calls'][number]): string {
  return `${call.name} ${call.input}`;
}

function listOrNone(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join('; ');
}

function excerpt(reply: string): string {
  if (reply.length === 0) return 'The reply is empty.';
  return reply.length > 300 ? `${reply.slice(0, 300)}...` : reply;
}
