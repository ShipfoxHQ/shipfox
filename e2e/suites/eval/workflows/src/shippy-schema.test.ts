import {describe, expect, it} from '@shipfox/vitest/vi';
import {CaseValidationError} from './schema.js';
import {DEFAULT_SHIPPY_LIVE_MODEL, parseShippyCase, resolveRunReferences} from './shippy-schema.js';

const unseededRunPattern = /names no seeded run: lint/u;
const duplicateKeysPattern = /run keys must be unique/u;
const unknownReferencePattern = /No seeded run named lint/u;

const validCase = {
  seed: {runs: [{key: 'deploy', workflow: 'deploy.yml', status: 'failed'}]},
  turns: [{message: 'Why did this fail?', page: {page: 'run', run: 'deploy'}}],
  expect: {tools: ['get_step_logs'], tool_input_contains: ['$runs.deploy.id']},
};

describe('parseShippyCase', () => {
  it('fills the defaults of a minimal case', () => {
    const parsed = parseShippyCase(validCase);

    expect(parsed.modes).toEqual(['scripted']);
    expect(parsed.timeout_seconds).toBe(600);
    expect(parsed.live.model).toBe(DEFAULT_SHIPPY_LIVE_MODEL);
    expect(parsed.k).toBe(3);
    expect(parsed.seed.workflows).toEqual([]);
    expect(parsed.expect.tools_absent).toEqual([]);
    expect(parsed.expect.no_new_runs).toBe(false);
    expect(parsed.expect.reply).toEqual({includes: [], excludes: []});
    expect(parsed.seed.runs[0]?.inputs).toEqual({});
  });

  it('rejects a page that names a run the case did not seed', () => {
    expect(() =>
      parseShippyCase({...validCase, turns: [{message: 'Why?', page: {page: 'run', run: 'lint'}}]}),
    ).toThrow(CaseValidationError);
    expect(() =>
      parseShippyCase({...validCase, turns: [{message: 'Why?', page: {page: 'run', run: 'lint'}}]}),
    ).toThrow(unseededRunPattern);
  });

  it('rejects duplicate run keys and unknown fields', () => {
    expect(() =>
      parseShippyCase({
        ...validCase,
        seed: {runs: [validCase.seed.runs[0], validCase.seed.runs[0]]},
      }),
    ).toThrow(duplicateKeysPattern);
    expect(() => parseShippyCase({...validCase, scenario: []})).toThrow(CaseValidationError);
  });
});

describe('resolveRunReferences', () => {
  const runs = new Map([['deploy', {id: 'run-1'}]]);

  it('replaces run references anywhere in a value', () => {
    expect(
      resolveRunReferences(
        [{args: {run_id: '$runs.deploy.id', nested: ['$runs.deploy.id']}, text: 'plain'}],
        runs,
      ),
    ).toEqual([{args: {run_id: 'run-1', nested: ['run-1']}, text: 'plain'}]);
  });

  it('rejects a reference to a run the case did not seed', () => {
    expect(() => resolveRunReferences({run_id: '$runs.lint.id'}, runs)).toThrow(
      unknownReferencePattern,
    );
  });
});
