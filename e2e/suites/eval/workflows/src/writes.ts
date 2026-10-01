import {isDeepStrictEqual} from 'node:util';
import type {RecordedWrite} from '@shipfox/e2e-core';
import type {PullRequestReference} from './references.js';

const MAX_PAYLOAD_CHARACTERS = 400;

/** One entry of `expect.writes`, after `$pr` references are resolved. */
type WriteExpectation = Record<string, {count: number} & Record<string, unknown>>;

interface Expectation {
  kind: string;
  count: number;
  target: string | undefined;
  payload: Record<string, unknown>;
  described: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPullRequest(value: unknown): value is PullRequestReference {
  return (
    isRecord(value) && typeof value.repository === 'string' && typeof value.number === 'number'
  );
}

function show(value: unknown): string {
  const json = JSON.stringify(value) ?? 'undefined';
  return json.length > MAX_PAYLOAD_CHARACTERS
    ? `${json.slice(0, MAX_PAYLOAD_CHARACTERS)}...`
    : json;
}

function describeWrite(write: RecordedWrite): string {
  return `${write.kind} ${write.target} ${show(write.payload)}`;
}

function isContainsMatcher(value: unknown): value is {contains: string} {
  return isRecord(value) && Object.keys(value).length === 1 && typeof value.contains === 'string';
}

// Objects match when every expected field matches, so an expectation names only what it cares
// about. `{contains: text}` matches a string that includes the text, for messages that carry
// values a case can't predict, such as a commit. Anything else, arrays included, must be equal.
function containsValue(actual: unknown, expected: unknown): boolean {
  if (isContainsMatcher(expected)) {
    return typeof actual === 'string' && actual.includes(expected.contains);
  }
  if (isRecord(expected) && isRecord(actual)) {
    return Object.entries(expected).every(([key, value]) => containsValue(actual[key], value));
  }
  return isDeepStrictEqual(actual, expected);
}

function toExpectation(entry: WriteExpectation): Expectation | string {
  const [kind, criteria] = Object.entries(entry)[0] ?? [];
  if (kind === undefined || criteria === undefined) return 'A write expectation is empty.';
  const {count, target, pull_request: pullRequest, ...payload} = criteria;
  let expectedTarget: string | undefined;
  if (pullRequest !== undefined) {
    if (!isPullRequest(pullRequest)) {
      return `${kind}: pull_request must be $pr, received ${show(pullRequest)}.`;
    }
    expectedTarget = `${pullRequest.repository}#${pullRequest.number}`;
  }
  if (target !== undefined) {
    if (typeof target !== 'string') return `${kind}: target must be a string.`;
    if (expectedTarget !== undefined && expectedTarget !== target) {
      return `${kind}: target ${target} and pull_request ${expectedTarget} name different targets.`;
    }
    expectedTarget = target;
  }
  const fields = {...(expectedTarget === undefined ? {} : {target: expectedTarget}), ...payload};
  return {
    kind,
    count,
    target: expectedTarget,
    payload,
    described: `${kind} ${show(fields)}`,
  };
}

function matches({write, expectation}: {write: RecordedWrite; expectation: Expectation}): boolean {
  if (write.kind !== expectation.kind) return false;
  if (expectation.target !== undefined && write.target !== expectation.target) return false;
  return containsValue(write.payload, expectation.payload);
}

function unmatchedFailures({
  expectations,
  recorded,
  matched,
}: {
  expectations: Expectation[];
  recorded: RecordedWrite[];
  matched: Map<Expectation, RecordedWrite[]>;
}): string[] {
  const failures: string[] = [];
  for (const write of recorded) {
    const hits = expectations.filter((expectation) => matches({write, expectation}));
    for (const hit of hits) matched.get(hit)?.push(write);
    if (hits.some((hit) => hit.count === 0)) {
      failures.push(`Forbidden write, expected none: ${describeWrite(write)}`);
    } else if (hits.length === 0) {
      failures.push(`Unexpected write, matches no entry: ${describeWrite(write)}`);
    }
  }
  return failures;
}

function countFailures(matched: Map<Expectation, RecordedWrite[]>): string[] {
  const failures: string[] = [];
  for (const [expectation, writes] of matched) {
    if (expectation.count === 0 || writes.length === expectation.count) continue;
    const found =
      writes.length === 0
        ? 'none was recorded'
        : `${writes.length} recorded:\n${writes.map((write) => `    ${describeWrite(write)}`).join('\n')}`;
    failures.push(`Expected ${expectation.count} of ${expectation.described}, ${found}`);
  }
  return failures;
}

/**
 * Checks the recorded writes against `expect.writes`, and returns what is wrong. Every write must
 * match an entry, and each entry must match exactly its `count`. A write that matches an entry
 * with `count: 0` is forbidden, and one that matches no entry is unexpected. Reads aren't
 * recorded, so they are never checked.
 */
export function checkWrites({
  expected,
  recorded,
}: {
  expected: WriteExpectation[];
  recorded: RecordedWrite[];
}): string[] {
  const parsed = expected.map(toExpectation);
  const invalid = parsed.filter((entry): entry is string => typeof entry === 'string');
  if (invalid.length > 0) return invalid;

  const expectations = parsed as Expectation[];
  const matched = new Map<Expectation, RecordedWrite[]>(
    expectations.map((expectation) => [expectation, []]),
  );
  return [...unmatchedFailures({expectations, recorded, matched}), ...countFailures(matched)];
}

/** Checks each expected workflow output against the run's outputs. Extra outputs are allowed. */
export function checkOutputs({
  expected,
  actual,
}: {
  expected: Record<string, unknown>;
  actual: Record<string, unknown> | null;
}): string[] {
  const failures: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    if (actual !== null && containsValue(actual[key], value)) continue;
    failures.push(
      `Expected output ${key} to be ${show(value)}, received ${show(actual?.[key])}. Outputs: ${show(actual)}`,
    );
  }
  return failures;
}
