import {describe, expect, it} from '@shipfox/vitest/vi';
import {fillSlots} from './compose.js';
import {composeExpectedVariant} from './onboarding-evidence.js';
import {diffAgainstTemplate} from './template-fidelity.js';

const SLOTS = {setup_commands: '- key: setup\n  run: npm ci', test_command: 'npm test'};
const OUTPUTS_LINE = /^outputs:$/mu;
const HEADER_LINE = /^# shipfox-template:.*$/mu;
const GITHUB_SOURCE =
  /^(\s*(?:-\s+)?(?:source|connection):\s*)github_source(\s+# bind:source)?$/gmu;

async function expectedYaml(): Promise<string> {
  return await composeExpectedVariant({
    expected: {
      outcome: 'validated',
      template: 'shipfox/ticket-to-pr',
      bindings: {source: 'github'},
    },
  });
}

/** What a careful agent writes: slots filled, connection slugs bound, everything else untouched. */
function carefulWorkflow(expected: string): string {
  return fillSlots({yaml: expected, slots: SLOTS}).replace(GITHUB_SOURCE, '$1acme-github');
}

describe('diffAgainstTemplate', () => {
  it('accepts a workflow with its slots filled and its connection slugs bound', async () => {
    const expected = await expectedYaml();

    expect(
      diffAgainstTemplate({expectedYaml: expected, writtenYaml: carefulWorkflow(expected)}),
    ).toEqual([]);
  });

  it('accepts another model on a model line', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replaceAll('gpt-6-luna # model:fix', 'other-model');

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toEqual([]);
  });

  it('ignores the header, which its own check reads', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replace(
      HEADER_LINE,
      '# shipfox-template: shipfox/ticket-to-pr@1.0.0; roles: source=github',
    );

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toEqual([]);
  });

  it('reports a line the agent dropped from the template body', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replace(OUTPUTS_LINE, '');

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toContainEqual({
      kind: 'missing',
      line: 'outputs:',
    });
  });

  it('reports a line the agent added to the template body', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replace(
      'runner: shipfox',
      'runner: shipfox\ntimeout: 3600',
    );

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toContainEqual({
      kind: 'added',
      line: 'timeout: 3600',
    });
  });

  it('accepts the value the agent settles on an option line', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replace(
      'draft: true # option:pr_mode',
      'draft: false',
    );

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toEqual([]);
  });

  it('reports a line added beside an option value the agent changed', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replace(
      'draft: true # option:pr_mode',
      'draft: false\n      unrelated: true',
    );

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toEqual([
      {kind: 'added', line: '      unrelated: true'},
    ]);
  });

  it('reports a trigger the agent replaced', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replace('source: manual', 'source: cron');

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toEqual([
      {kind: 'missing', line: '    source: manual'},
      {kind: 'added', line: '    source: cron'},
    ]);
  });

  it('reports an option block the agent left unresolved', async () => {
    const expected = await expectedYaml();
    const written = carefulWorkflow(expected).replace(
      'runner: shipfox',
      'runner: shipfox\n# option:pr_mode=ready begin',
    );

    expect(diffAgainstTemplate({expectedYaml: expected, writtenYaml: written})).toContainEqual({
      kind: 'added',
      line: '# option:pr_mode=ready begin',
    });
  });
});
