import {describe, expect, it} from '@shipfox/vitest/vi';
import {discoverShippyCases} from './shippy-run.js';
import {parseShippyCase, resolveRunReferences} from './shippy-schema.js';

describe('shipped Shippy cases', () => {
  it('cover routing, a seeded failure, page context, and an instruction in a log', async () => {
    const cases = await discoverShippyCases();

    expect(cases.map(({id}) => id).sort()).toEqual([
      'ignores-log-instructions',
      'names-seeded-failure',
      'resolves-this-from-page',
      'routes-run-question',
      'routes-workflow-question',
    ]);
  });
});

describe('parseShippyCase', () => {
  it('rejects a run of a workflow the case does not declare', () => {
    expect(() =>
      parseShippyCase({
        description: 'A case',
        runs: [{name: 'build', workflow: 'build', status: 'failed'}],
        messages: [{body: 'Why?'}],
        expect: {},
      }),
    ).toThrow('"build" is not one of the case\'s workflows.');
  });
});

describe('resolveRunReferences', () => {
  it('replaces each run reference with the seeded run ID', () => {
    const runIds = new Map([['build', 'run-1']]);

    expect(resolveRunReferences('run $runs.build', runIds)).toBe('run run-1');
  });

  it('rejects a reference to a run the case does not seed', () => {
    expect(() => resolveRunReferences('$runs.deploy', new Map())).toThrow(
      'The case seeds no run named "deploy".',
    );
  });
});
