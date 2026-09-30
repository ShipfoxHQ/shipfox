import type {RecordedWrite} from '@shipfox/e2e-core';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseTemplateCase} from './schema.js';
import {checkOutputs, checkWrites} from './writes.js';

const exactlyOneKind = /exactly one kind/u;
const writesPath = /writes/u;

const pr = {number: 3, head: 'shipfox/task', base: 'main', sha: 'abc', repository: 'acme/app'};

const push: RecordedWrite = {
  kind: 'github.push',
  target: 'acme/app:shipfox/task',
  payload: {repository: 'acme/app', branch: 'shipfox/task', before: null, after: 'abc'},
};
const createPullRequest: RecordedWrite = {
  kind: 'github.create_pull_request',
  target: 'acme/app#3',
  payload: {base: 'main', head: 'shipfox/task', draft: true, title: 'Add a flag'},
};
const comment: RecordedWrite = {
  kind: 'github.create_issue_comment',
  target: 'acme/app#12',
  payload: {body: 'Working on it'},
};

const expectedPush = {'github.push': {branch: pr.head, count: 1}};
const expectedPullRequest = {'github.create_pull_request': {base: 'main', draft: true, count: 1}};

describe('checkWrites', () => {
  it('passes when every write matches an entry with its exact count', () => {
    const failures = checkWrites({
      expected: [
        expectedPush,
        expectedPullRequest,
        {'github.create_pull_request': {pull_request: pr, count: 1}},
      ],
      recorded: [push, createPullRequest],
    });

    expect(failures).toEqual([]);
  });

  it('matches a string field that contains the expected text', () => {
    const message: RecordedWrite = {
      kind: 'slack.chat.postMessage',
      target: 'C1',
      payload: {text: 'Ticket ENG-101 tracks this thread at `abc123`'},
    };
    const contains = (text: string) => [
      {'slack.chat.postMessage': {text: {contains: text}, count: 1}},
    ];

    expect(checkWrites({expected: contains('Ticket ENG-101'), recorded: [message]})).toEqual([]);
    expect(checkWrites({expected: contains('Ticket ENG-102'), recorded: [message]})).toHaveLength(
      2,
    );
  });

  it('fails a count mismatch and lists the writes that matched', () => {
    const failures = checkWrites({
      expected: [{'github.push': {branch: pr.head, count: 2}}],
      recorded: [push],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('Expected 2 of github.push');
    expect(failures[0]).toContain('1 recorded');
    expect(failures[0]).toContain('"after":"abc"');
  });

  it('fails an expected write that was never recorded, with the fields it asked for', () => {
    const failures = checkWrites({expected: [expectedPush], recorded: []});

    expect(failures).toEqual([
      'Expected 1 of github.push {"branch":"shipfox/task"}, none was recorded',
    ]);
  });

  it('fails a forbidden write with its payload', () => {
    const failures = checkWrites({
      expected: [expectedPush, {'github.create_issue_comment': {count: 0}}],
      recorded: [push, comment],
    });

    expect(failures).toEqual([
      'Forbidden write, expected none: github.create_issue_comment acme/app#12 {"body":"Working on it"}',
    ]);
  });

  it('fails a write that matches no entry with its payload', () => {
    const failures = checkWrites({expected: [expectedPush], recorded: [push, comment]});

    expect(failures).toEqual([
      'Unexpected write, matches no entry: github.create_issue_comment acme/app#12 {"body":"Working on it"}',
    ]);
  });

  it('fails every write when the case expects none', () => {
    expect(checkWrites({expected: [], recorded: [push]})).toHaveLength(1);
    expect(checkWrites({expected: [], recorded: []})).toEqual([]);
  });

  it('matches the pull request a write acted on, not just its kind', () => {
    const other = {...comment, kind: 'github.reply_to_review_comment', target: 'acme/app#4'};
    const failures = checkWrites({
      expected: [{'github.reply_to_review_comment': {pull_request: pr, count: 1}}],
      recorded: [other],
    });

    expect(failures.join('\n')).toContain('Unexpected write');
    expect(failures.join('\n')).toContain('Expected 1 of github.reply_to_review_comment');
  });

  it('matches an explicit target', () => {
    const failures = checkWrites({
      expected: [{'github.create_issue_comment': {target: 'acme/app#12', count: 1}}],
      recorded: [comment],
    });

    expect(failures).toEqual([]);
  });

  it('matches payload fields as a subset', () => {
    const wrongBase = checkWrites({
      expected: [{'github.create_pull_request': {base: 'develop', count: 1}}],
      recorded: [createPullRequest],
    });

    expect(wrongBase).toHaveLength(2);
  });

  it('matches a string field that contains every text in a list', () => {
    const report: RecordedWrite = {
      kind: 'slack.chat.postMessage',
      target: 'C0FAILURES',
      payload: {channel: 'C0FAILURES', text: 'Build #1 failed\nFailed: build'},
    };
    const contains = (texts: string[]) => [
      {'slack.chat.postMessage': {text: {contains: texts}, count: 1}},
    ];

    expect(checkWrites({expected: contains(['Build #1', 'Failed: build']), recorded: [report]})).toEqual(
      [],
    );
    expect(checkWrites({expected: contains(['Build #1', 'Failed: test']), recorded: [report]})).toHaveLength(2);
    expect(checkWrites({expected: contains([]), recorded: [report]})).toHaveLength(2);
  });

  it('rejects a pull request reference that is not $pr', () => {
    const failures = checkWrites({
      expected: [{'github.push': {pull_request: 'acme/app#3', count: 1}}],
      recorded: [],
    });

    expect(failures).toEqual(['github.push: pull_request must be $pr, received "acme/app#3".']);
  });

  it('shortens long payloads in a message', () => {
    const long = {...comment, payload: {body: 'x'.repeat(2_000)}};

    const [failure] = checkWrites({expected: [], recorded: [long]});

    expect(failure?.length).toBeLessThan(600);
    expect(failure).toContain('...');
  });
});

describe('checkOutputs', () => {
  it('passes when every expected output matches and allows extra outputs', () => {
    const failures = checkOutputs({
      expected: {status: 'implemented'},
      actual: {status: 'implemented', pr_title: 'Add a flag'},
    });

    expect(failures).toEqual([]);
  });

  it('fails a different value and a missing output, with the run outputs', () => {
    const failures = checkOutputs({
      expected: {status: 'implemented', questions: ['Which flag?']},
      actual: {status: 'needs_clarification'},
    });

    expect(failures).toEqual([
      'Expected output status to be "implemented", received "needs_clarification". Outputs: {"status":"needs_clarification"}',
      'Expected output questions to be ["Which flag?"], received undefined. Outputs: {"status":"needs_clarification"}',
    ]);
  });

  it('fails when the run has no outputs', () => {
    expect(checkOutputs({expected: {status: 'implemented'}, actual: null})).toHaveLength(1);
  });
});

describe('write expectations in a case', () => {
  const base = {template: 'shipfox/fixture', scenario: [{await: {run: 'succeeded'}}]};

  it('defaults an entry to exactly one write', () => {
    const templateCase = parseTemplateCase({...base, expect: {writes: [{'github.push': {}}]}});

    expect(templateCase.expect.writes).toEqual([{'github.push': {count: 1}}]);
  });

  it('rejects an entry that names two kinds or a negative count', () => {
    const twoKinds = {writes: [{'github.push': {}, 'github.add_labels': {}}]};
    const negative = {writes: [{'github.push': {count: -1}}]};

    expect(() => parseTemplateCase({...base, expect: twoKinds})).toThrow(exactlyOneKind);
    expect(() => parseTemplateCase({...base, expect: negative})).toThrow(writesPath);
  });
});
