import type {ShippyExpect} from './shippy-schema.js';

export interface ConversationToolCall {
  name: string;
  /** The arguments as the model sent them, JSON-encoded. */
  input: string;
}

/** One human message and what the agent did with it. */
export interface ConversationTurnRecord {
  message: string;
  status: 'succeeded' | 'failed' | 'stopped' | 'denied' | 'missing';
  failure_code: string | null;
  /** The agent's text, with every message of the turn joined. */
  reply: string;
  tool_calls: ConversationToolCall[];
}

export interface ShippyCheck {
  id: string;
  passed: boolean;
  detail?: string;
}

export interface ShippyGrade {
  checks: ShippyCheck[];
  passed: boolean;
}

const REGEX_PATTERN = /^\/(.+)\/([a-z]*)$/su;

/** A pattern between slashes is a regular expression; anything else is a substring. */
export function matchesPattern(text: string, pattern: string): boolean {
  const match = REGEX_PATTERN.exec(pattern);
  if (match === null) return text.includes(pattern);
  return new RegExp(match[1] ?? '', match[2]).test(text);
}

function check(id: string, passed: boolean, detail?: string): ShippyCheck {
  return {id, passed, ...(passed || detail === undefined ? {} : {detail})};
}

function describeCalls(calls: ConversationToolCall[]): string {
  if (calls.length === 0) return 'no tool was called';
  return `called ${calls.map((call) => `${call.name}(${call.input})`).join(', ')}`;
}

/**
 * Checks a finished conversation against the case's expectations. Every turn must succeed, the
 * expected tools must have been called and the forbidden ones never, some call must carry each
 * expected input, the last reply must match its patterns, and no run may have started unless
 * the case allows it.
 */
export function gradeShippyConversation({
  expect,
  turns,
  newRunIds = [],
}: {
  expect: ShippyExpect;
  turns: ConversationTurnRecord[];
  /** Runs that started in the project while the conversation ran. */
  newRunIds?: readonly string[];
}): ShippyGrade {
  const checks: ShippyCheck[] = turns.map((turn, index) =>
    check(
      `turn:${index + 1}:succeeded`,
      turn.status === 'succeeded',
      `ended ${turn.status}${turn.failure_code ? ` (${turn.failure_code})` : ''}`,
    ),
  );
  const calls = turns.flatMap((turn) => turn.tool_calls);
  for (const name of expect.tools) {
    const called = calls.some((call) => call.name === name);
    checks.push(check(`tool:${name}`, called, `${name} was not called; ${describeCalls(calls)}`));
  }
  for (const name of expect.tools_absent) {
    const called = calls.filter((call) => call.name === name);
    checks.push(
      check(
        `tool_absent:${name}`,
        called.length === 0,
        `${name} was called ${called.length} times`,
      ),
    );
  }
  for (const text of expect.tool_input_contains) {
    const found = calls.some((call) => call.input.includes(text));
    checks.push(check(`tool_input:${text}`, found, `no call carried it; ${describeCalls(calls)}`));
  }
  const reply = turns.at(-1)?.reply ?? '';
  for (const pattern of expect.reply.includes) {
    checks.push(
      check(`reply.includes:${pattern}`, matchesPattern(reply, pattern), `reply: ${reply}`),
    );
  }
  for (const pattern of expect.reply.excludes) {
    checks.push(
      check(`reply.excludes:${pattern}`, !matchesPattern(reply, pattern), `reply: ${reply}`),
    );
  }
  if (expect.no_new_runs) {
    checks.push(check('no_new_runs', newRunIds.length === 0, `started ${newRunIds.join(', ')}`));
  }
  return {checks, passed: checks.every((entry) => entry.passed)};
}
