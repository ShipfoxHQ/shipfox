import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  collectOnboardingEvidence,
  composeExpectedVariant,
  listWorkspaceModelIds,
  parseEnvelope,
  runDryRuns,
  type ToolCaller,
  type ToolEnvelope,
} from './onboarding-evidence.js';

const WORKFLOW = 'triggers:\n  manual:\n    source: manual\n  labeled:\n    source: acme-github\n';
const FILE = {path: '.shipfox/workflows/x.yml', content: WORKFLOW};
const dryRunPattern = /dry_run/u;
const failedListPattern = /list_workspace_models failed: forbidden/u;
const unknownTemplatePattern = /does not serve shipfox\/unknown/u;

function fakeCaller(answer: (name: string, args: Record<string, unknown>) => ToolEnvelope): {
  caller: ToolCaller;
  calls: Array<{name: string; args: Record<string, unknown>}>;
  closed: () => boolean;
} {
  const calls: Array<{name: string; args: Record<string, unknown>}> = [];
  let closed = false;
  return {
    calls,
    closed: () => closed,
    caller: {
      call: (name, args) => {
        calls.push({name, args});
        return Promise.resolve(answer(name, args));
      },
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    },
  };
}

describe('parseEnvelope', () => {
  it('reads structured content', () => {
    expect(parseEnvelope({structuredContent: {ok: true, result: {check_passed: true}}})).toEqual({
      ok: true,
      result: {check_passed: true},
    });
  });

  it('falls back to the JSON text of the first content block', () => {
    const text = JSON.stringify({ok: false, error: {code: 'invalid-definition', message: 'bad'}});

    expect(parseEnvelope({content: [{type: 'text', text}]})).toEqual({
      ok: false,
      error: {code: 'invalid-definition', message: 'bad'},
    });
  });

  it('reports a result that is no envelope', () => {
    expect(parseEnvelope({content: [{type: 'text', text: 'plain'}]})).toEqual({
      ok: false,
      error: {code: 'unparseable'},
    });
  });
});

describe('runDryRuns', () => {
  it('dry-runs every trigger of the workflow with its content', async () => {
    const {caller, calls} = fakeCaller(() => ({ok: true, result: {check_passed: true}}));

    const outcomes = await runDryRuns({caller, projectId: 'project-1', file: FILE});

    expect(outcomes).toEqual([
      {trigger: 'manual', passed: true},
      {trigger: 'labeled', passed: true},
    ]);
    expect(calls.map((entry) => entry.args)).toEqual([
      {
        project_id: 'project-1',
        config_path: FILE.path,
        trigger: 'manual',
        content: WORKFLOW,
        dry_run: true,
      },
      {
        project_id: 'project-1',
        config_path: FILE.path,
        trigger: 'labeled',
        content: WORKFLOW,
        dry_run: true,
      },
    ]);
  });

  it('reports the refusal of a trigger with its first errors', async () => {
    const {caller} = fakeCaller((_name, args) =>
      args.trigger === 'labeled'
        ? {
            ok: false,
            error: {
              code: 'invalid-definition',
              message: 'The workflow is invalid.',
              details: {errors: [{path: 'triggers.labeled', message: 'Unknown connection'}]},
            },
          }
        : {ok: true, result: {check_passed: true}},
    );

    const outcomes = await runDryRuns({caller, projectId: 'project-1', file: FILE});

    expect(outcomes).toEqual([
      {trigger: 'manual', passed: true},
      {
        trigger: 'labeled',
        passed: false,
        detail: 'invalid-definition: The workflow is invalid.: triggers.labeled Unknown connection',
      },
    ]);
  });

  it('fails a check that did not pass without an error', async () => {
    const {caller} = fakeCaller(() => ({ok: true, result: {check_passed: false}}));

    const outcomes = await runDryRuns({caller, projectId: 'project-1', file: FILE});

    expect(outcomes.every((outcome) => !outcome.passed)).toBe(true);
  });

  it('fails a workflow with no triggers without calling the stack', async () => {
    const {caller, calls} = fakeCaller(() => ({ok: true, result: {check_passed: true}}));

    const outcomes = await runDryRuns({
      caller,
      projectId: 'project-1',
      file: {path: FILE.path, content: 'name: x'},
    });

    expect(outcomes).toEqual([
      {trigger: '-', passed: false, detail: 'The workflow declares no triggers to check.'},
    ]);
    expect(calls).toEqual([]);
  });
});

describe('listWorkspaceModelIds', () => {
  it('follows the cursor to the last page', async () => {
    const {caller} = fakeCaller((_name, args) =>
      args.cursor === undefined
        ? {ok: true, result: {models: [{id: 'a'}, {id: 'b'}], next_cursor: 'next'}}
        : {ok: true, result: {models: [{id: 'c'}], next_cursor: null}},
    );

    expect(await listWorkspaceModelIds(caller)).toEqual(['a', 'b', 'c']);
  });

  it('fails when the listing is refused', async () => {
    const {caller} = fakeCaller(() => ({ok: false, error: {code: 'forbidden'}}));

    await expect(listWorkspaceModelIds(caller)).rejects.toThrow(failedListPattern);
  });
});

describe('composeExpectedVariant', () => {
  it('applies the manifest defaults for options the case leaves out', async () => {
    const yaml = await composeExpectedVariant({
      expected: {
        outcome: 'validated',
        template: 'shipfox/ticket-to-pr',
        bindings: {source: 'github'},
      },
    });

    expect(yaml).not.toContain(' begin');
  });

  it('lets the case settle an option', async () => {
    const addressed = await composeExpectedVariant({
      expected: {
        outcome: 'validated',
        template: 'shipfox/ticket-to-pr',
        bindings: {source: 'github'},
        options: {resolve_threads: 'addressed'},
      },
    });
    const never = await composeExpectedVariant({
      expected: {
        outcome: 'validated',
        template: 'shipfox/ticket-to-pr',
        bindings: {source: 'github'},
        options: {resolve_threads: 'never'},
      },
    });

    expect(never).not.toBe(addressed);
  });

  it('fails for a template the loader does not serve', async () => {
    await expect(
      composeExpectedVariant({expected: {outcome: 'validated', template: 'shipfox/unknown'}}),
    ).rejects.toThrow(unknownTemplatePattern);
  });
});

describe('collectOnboardingEvidence', () => {
  const expected = {
    outcome: 'validated',
    template: 'shipfox/ticket-to-pr',
    bindings: {source: 'github'},
  } as const;

  it('gathers the dry runs, the models, and the expected variant, then closes the caller', async () => {
    const fake = fakeCaller((name) =>
      name === 'create_dev_run'
        ? {ok: true, result: {check_passed: true}}
        : {ok: true, result: {models: [{id: 'gpt-6-luna'}], next_cursor: null}},
    );

    const evidence = await collectOnboardingEvidence({
      expected,
      files: [FILE],
      projectId: 'project-1',
      mcpUrl: 'http://proxy/mcp',
      connect: () => Promise.resolve(fake.caller),
    });

    expect(evidence.dry_runs).toHaveLength(2);
    expect(evidence.workspace_models).toEqual(['gpt-6-luna']);
    expect(evidence.expected_yaml).toContain('# shipfox-template:');
    expect(fake.closed()).toBe(true);
  });

  it('gathers nothing for an outcome that writes no workflow, or when none was written', async () => {
    const connect = () => Promise.reject(new Error('The stack must not be called.'));

    expect(
      await collectOnboardingEvidence({
        expected: {outcome: 'needs_clarification'},
        files: [FILE],
        projectId: 'project-1',
        mcpUrl: 'http://proxy/mcp',
        connect,
      }),
    ).toEqual({});
    expect(
      await collectOnboardingEvidence({
        expected,
        files: [],
        projectId: 'project-1',
        mcpUrl: 'http://proxy/mcp',
        connect,
      }),
    ).toEqual({});
  });

  it('closes the caller when a call fails', async () => {
    const fake = fakeCaller(() => {
      throw new Error('The stack went away.');
    });

    await expect(
      collectOnboardingEvidence({
        expected: {outcome: 'validated'},
        files: [FILE],
        projectId: 'project-1',
        mcpUrl: 'http://proxy/mcp',
        connect: () => Promise.resolve(fake.caller),
      }),
    ).rejects.toThrow('The stack went away.');
    expect(fake.closed()).toBe(true);
  });

  it('never asks for a real run', async () => {
    const fake = fakeCaller(() => ({ok: true, result: {check_passed: true, models: []}}));

    await collectOnboardingEvidence({
      expected: {outcome: 'validated'},
      files: [FILE],
      projectId: 'project-1',
      mcpUrl: 'http://proxy/mcp',
      connect: () => Promise.resolve(fake.caller),
    });

    const runs = fake.calls.filter((entry) => entry.name === 'create_dev_run');
    expect(runs.every((entry) => entry.args.dry_run === true)).toBe(true);
    expect(JSON.stringify(runs)).toMatch(dryRunPattern);
  });
});
