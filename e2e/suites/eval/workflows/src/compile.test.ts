import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {shippedTemplateLoader} from '@shipfox/workflow-templates';
import {createDirectoryTemplateLoader} from '@shipfox/workflow-templates/testing';
import {parse as parseYaml} from 'yaml';
import {parseEvalArgs} from './cli.js';
import {
  bindConnectionSlugs,
  checkCompiledDefinition,
  fillTemplatePlaceholders,
  listCompileVariants,
  runCompile,
} from './compile.js';
import type {CaseResult} from './results.js';

const brokenCatalog = fileURLToPath(
  new URL('../cases/compile/broken-trigger/catalog', import.meta.url),
);
const unboundRolePattern = /binds role "tracker", which the variant does not/u;
const noVariantsPattern = /No template variants matching "missing"/u;
const onboardingCompilePattern = /--mode compile applies to --suite templates and contracts only/u;
const catalogModePattern = /--catalog applies to --suite templates --mode compile only/u;
const slugPlaceholderPattern = /_(?:tracker|source|chat|report|notify)\s+# bind:/u;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, {recursive: true})),
  );
});

describe('template variants to compile', () => {
  it('lists every variant of every shipped template, Jira included, with a unique id', async () => {
    const variants = await listCompileVariants({loader: shippedTemplateLoader});
    const ids = variants.map(({id}) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.startsWith('ticket-to-pr/') && id.includes('tracker=jira'))).toBe(
      true,
    );
    expect(ids).toContain('report-failed-runs/notify=slack');
  });

  it('filters by template id', async () => {
    const variants = await listCompileVariants({
      loader: shippedTemplateLoader,
      filter: 'ask-codebase',
    });

    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every(({id}) => id.startsWith('ask-codebase/'))).toBe(true);
  });

  it('composes, fills, and binds every shipped variant into YAML that parses', async () => {
    for (const variant of await listCompileVariants({loader: shippedTemplateLoader})) {
      const composed = await shippedTemplateLoader.compose({
        package: variant.template.package,
        bindings: variant.bindings,
        options: variant.options,
      });
      if (composed === undefined) throw new Error(`${variant.id} did not compose`);
      const slugs = Object.fromEntries(
        Object.entries(variant.bindings).map(([role, provider]) => [role, `${provider}_acme`]),
      );

      const yaml = bindConnectionSlugs({yaml: fillTemplatePlaceholders(composed), slugs});

      expect(yaml, variant.id).not.toContain('replace-with-');
      expect(yaml, variant.id).not.toMatch(slugPlaceholderPattern);
      expect(() => parseYaml(yaml), variant.id).not.toThrow();
    }
  });
});

describe('placeholders and connection slugs', () => {
  it('fills slot markers and replace-with values', () => {
    const yaml = [
      'steps:',
      '  # slot:setup',
      '  - run: replace-with-test-command # slot:test',
      '  - filter: label == "replace-with-label"',
    ].join('\n');

    expect(fillTemplatePlaceholders(yaml)).toBe(
      [
        'steps:',
        '  - run: echo slot-placeholder',
        '  - run: echo slot-placeholder ',
        '  - filter: label == "echo slot-placeholder"',
      ].join('\n'),
    );
  });

  it('replaces the placeholder connection with the slug of the role', () => {
    const yaml = [
      'on:',
      '  source: linear_tracker # bind:tracker',
      '  - connection: github_source # bind:source',
      'untouched: linear_tracker',
    ].join('\n');

    expect(
      bindConnectionSlugs({yaml, slugs: {tracker: 'linear_acme', source: 'github_acme'}}),
    ).toBe(
      [
        'on:',
        '  source: linear_acme # bind:tracker',
        '  - connection: github_acme # bind:source',
        'untouched: linear_tracker',
      ].join('\n'),
    );
  });

  it('rejects a marker for a role the variant does not bind', () => {
    expect(() =>
      bindConnectionSlugs({yaml: 'source: linear_tracker # bind:tracker', slugs: {}}),
    ).toThrow(unboundRolePattern);
  });
});

describe('compiled definition check', () => {
  const yaml = [
    'triggers:',
    '  manual:',
    '    source: manual',
    '  on_review:',
    '    source: github_acme',
    '    event: pull_request_review_comment',
    'jobs:',
    '  respond:',
    '    listening:',
    '      on:',
    '        - source: github_acme',
    '          event: pull_request_review_comment',
    '      until:',
    '        - source: github_acme',
    '          event: pull_request',
    '        - source: github_acme',
    '          event: workflow_run',
  ].join('\n');
  const activeModel = {
    triggers: [
      {key: 'manual', source: 'manual', event: 'fire'},
      {key: 'on_review', source: 'github_acme', event: 'pull_request_review_comment'},
    ],
    jobs: [
      {
        key: 'respond',
        listening: {
          on: [{source: 'github_acme', event: 'pull_request_review_comment'}],
          until: [
            {source: 'github_acme', event: 'pull_request'},
            {source: 'github_acme', event: 'workflow_run'},
          ],
        },
      },
    ],
  };

  it('accepts a definition with no error diagnostics and every matcher active', () => {
    expect(
      checkCompiledDefinition({
        yaml,
        definition: {
          diagnostics: [{code: 'unknown-trigger-event', message: 'x', severity: 'warning'}],
          workflow_model: activeModel,
        },
      }),
    ).toEqual([]);
  });

  it('reports an error diagnostic', () => {
    expect(
      checkCompiledDefinition({
        yaml,
        definition: {
          diagnostics: [
            {
              code: 'invalid-trigger-event',
              message: 'Event is never delivered.',
              path: 'triggers.on_review.event',
              severity: 'error',
            },
          ],
          workflow_model: activeModel,
        },
      }),
    ).toEqual([
      'Error diagnostic invalid-trigger-event at triggers.on_review.event: Event is never delivered.',
    ]);
  });

  it('reports a trigger the model dropped', () => {
    expect(
      checkCompiledDefinition({
        yaml,
        definition: {
          diagnostics: [],
          workflow_model: {...activeModel, triggers: [activeModel.triggers[0]]},
        },
      }),
    ).toEqual(['Trigger "on_review" (github_acme pull_request_review_comment) is not active.']);
  });

  it('reports the listening matchers the model dropped, by index', () => {
    const model = {
      ...activeModel,
      jobs: [
        {
          key: 'respond',
          listening: {
            on: [],
            until: [{source: 'github_acme', event: 'workflow_run'}],
          },
        },
      ],
    };

    expect(
      checkCompiledDefinition({yaml, definition: {diagnostics: [], workflow_model: model}}),
    ).toEqual([
      'Job "respond" listening.on[0] (github_acme pull_request_review_comment) is not active.',
      'Job "respond" listening.until[0] (github_acme pull_request) is not active.',
    ]);
  });

  it('fails a fixture template with a broken trigger although the definition is created', async () => {
    const loader = createDirectoryTemplateLoader(brokenCatalog);
    const [variant] = await listCompileVariants({loader});
    if (variant === undefined) throw new Error('The broken fixture has no variants');
    const composed = await loader.compose({
      package: variant.template.package,
      bindings: variant.bindings,
      options: variant.options,
    });
    if (composed === undefined) throw new Error('The broken fixture did not compose');
    // What the definitions endpoint answers: success, the broken trigger flagged and left out.
    const definition = {
      diagnostics: [
        {
          code: 'invalid-cron-schedule',
          message: 'Invalid cron schedule.',
          path: 'triggers.nightly.config.schedule',
          severity: 'error' as const,
        },
      ],
      workflow_model: {triggers: [{key: 'manual', source: 'manual', event: 'fire'}], jobs: []},
    };

    expect(checkCompiledDefinition({yaml: composed, definition})).toEqual([
      'Error diagnostic invalid-cron-schedule at triggers.nightly.config.schedule: Invalid cron schedule.',
      'Trigger "nightly" (cron) is not active.',
    ]);
  });
});

describe('compile run', () => {
  it('writes one result per variant and keeps going after a failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-eval-compile-'));
    temporaryDirectories.push(root);
    const compiled: string[] = [];

    const run = await runCompile({
      caseFilter: 'ask-codebase',
      resultsDirectory: join(root, 'results'),
      runId: 'compile',
      compile: ({id}) => {
        compiled.push(id);
        const failing = compiled.length === 1;
        const result: CaseResult = {
          case: id,
          mode: 'compile',
          repeat: 1,
          status: failing ? 'error' : 'passed',
          duration_ms: 1,
          cost_usd: 0,
          ...(failing ? {error: 'Trigger "nightly" (cron) is not active.'} : {}),
        };
        return Promise.resolve(result);
      },
    });

    expect(compiled.length).toBeGreaterThan(1);
    expect(run.results.map(({case: id}) => id)).toEqual(compiled);
    expect(run.results.map(({status}) => status)).toEqual([
      'error',
      ...compiled.slice(1).map(() => 'passed'),
    ]);
  });

  it('fails when no template matches the filter', async () => {
    await expect(
      runCompile({
        catalog: brokenCatalog,
        caseFilter: 'missing',
        compile: async () => Promise.reject(),
      }),
    ).rejects.toThrow(noVariantsPattern);
  });
});

describe('compile options', () => {
  it('parses the compile mode and its catalog', () => {
    expect(
      parseEvalArgs(['--mode', 'compile', '--catalog', 'fixtures', '--case', 'ticket-to-pr']),
    ).toMatchObject({
      mode: 'compile',
      catalog: 'fixtures',
      caseFilter: 'ticket-to-pr',
    });
  });

  it('rejects the compile mode for the onboarding suite', () => {
    expect(() => parseEvalArgs(['--suite', 'onboarding', '--mode', 'compile'])).toThrow(
      onboardingCompilePattern,
    );
  });

  it('rejects a catalog outside the compile mode', () => {
    expect(() => parseEvalArgs(['--catalog', 'fixtures'])).toThrow(catalogModePattern);
  });
});
