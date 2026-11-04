import type {ShippyExpect} from './shippy-schema.js';

export interface ConversationToolCall {
  name: string;
  args: Record<string, unknown>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every expected key must equal the actual value, and nested objects are compared the same way. */
export function argsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const found = actual[key];
    if (isRecord(value)) return isRecord(found) && argsMatch(value, found);
    return JSON.stringify(found) === JSON.stringify(value);
  });
}

function check(id: string, passed: boolean, detail?: string): ShippyCheck {
  return {id, passed, ...(passed || detail === undefined ? {} : {detail})};
}

function describeCalls(calls: ConversationToolCall[]): string {
  if (calls.length === 0) return 'no tool was called';
  return `called ${calls.map((call) => `${call.name}(${JSON.stringify(call.args)})`).join(', ')}`;
}

/**
 * Checks a finished conversation against the case's expectations. Every turn must succeed, the
 * expected tools must have been called with the given arguments, the forbidden ones never, and
 * the last reply must match its patterns.
 */
export function gradeShippyConversation({
  expect,
  turns,
}: {
  expect: ShippyExpect;
  turns: ConversationTurnRecord[];
}): ShippyGrade {
  const checks: ShippyCheck[] = turns.map((turn, index) =>
    check(
      `turn:${index + 1}:succeeded`,
      turn.status === 'succeeded',
      `ended ${turn.status}${turn.failure_code ? ` (${turn.failure_code})` : ''}`,
    ),
  );
  const calls = turns.flatMap((turn) => turn.tool_calls);
  for (const tool of expect.tools) {
    const matched = calls.some(
      (call) =>
        call.name === tool.name && (tool.args === undefined || argsMatch(tool.args, call.args)),
    );
    const wanted =
      tool.args === undefined ? tool.name : `${tool.name}(${JSON.stringify(tool.args)})`;
    checks.push(
      check(`tool:${tool.name}`, matched, `${wanted} was not called; ${describeCalls(calls)}`),
    );
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
  return {checks, passed: checks.every((entry) => entry.passed)};
}
