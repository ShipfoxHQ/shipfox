import {readFileSync} from 'node:fs';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import type {PartBlocks} from './composer.js';
import {applyTemplateOptions, composeTemplate, templateRoleBindings} from './composer.js';
import type {WorkflowTemplate, WorkflowTemplateAsset} from './loader.js';
import {createTemplateLoader, loadShippedTemplates} from './loader.js';
import {type WorkflowTemplateOption, workflowTemplateManifestSchema} from './manifest.js';
import {extractModelAnchors} from './model-anchors.js';

const missingThinkingPattern = /thinking: high\s*/u;
const guideWritesSectionPattern = /^#+ (Prerequisites|Expected writes)/mu;
const optionBlockMarkerPattern = /# option:[a-z0-9_-]+=/u;
const fixtureRoot = new URL('../test/fixtures/', import.meta.url);
const fixture: WorkflowTemplateAsset = {
  id: 'fixture-ticket-to-pr',
  revision: 1,
  added_at: '2026-10-01',
  rank: 1,
  manifest: workflowTemplateManifestSchema.parse(
    parseYaml(readFileSync(new URL('template.yaml', fixtureRoot), 'utf8')),
  ),
  workflow: readFileSync(new URL('workflow.yml', fixtureRoot), 'utf8'),
  guide: readFileSync(new URL('GUIDE.md', fixtureRoot), 'utf8'),
  parts: {
    tracker: {
      linear: parsePart('parts/tracker/linear.yml'),
      github: parsePart('parts/tracker/github.yml'),
    },
    source: {github: parsePart('parts/source/github.yml')},
  },
};

function defaultChoice(option: WorkflowTemplateOption): string {
  const choice =
    option.choices.find(({default: isDefault}) => isDefault === true) ?? option.choices[0];
  if (choice === undefined) throw new Error(`Option ${option.id} has no choices`);
  return choice.id;
}

function parsePart(path: string): PartBlocks {
  return parseYaml(readFileSync(new URL(path, fixtureRoot), 'utf8')) as PartBlocks;
}

describe('workflow template loader', () => {
  it('composes and parses every role combination within the payload limit', () => {
    const loader = createTemplateLoader([fixture]);
    const template = loader.get('fixture-ticket-to-pr');
    if (template === undefined) throw new Error('Fixture template was not loaded');

    const trackerRole = template.manifest.roles.tracker;
    if (trackerRole === undefined) throw new Error('Fixture tracker role was not loaded');

    for (const tracker of trackerRole.providers) {
      const composed = composeTemplate(template, {tracker, source: 'github'});

      parseWorkflowDocument(parseYaml(composed));
      expect(Buffer.byteLength(composed, 'utf8')).toBeLessThan(64 * 1024);
    }
  });

  it('does not expose test fixtures through the shipped loader', () => {
    expect(loadShippedTemplates().map((template) => template.id)).toEqual([
      'ask-codebase',
      'fix-default-branch-ci',
      'fix-dependency-ci',
      'report-failed-runs',
      'slack-dispatcher',
      'slack-to-ticket',
      'ticket-to-pr',
    ]);
  });

  it('extracts anchors from every shipped role combination', () => {
    const expected = {
      'ask-codebase': {answer: {model: 'gpt-6-sol', thinking: 'high'}},
      'fix-default-branch-ci': {investigate: {model: 'gpt-6-sol', thinking: 'high'}},
      'fix-dependency-ci': {fix: {model: 'gpt-6-sol', thinking: 'high'}},
      'report-failed-runs': {diagnose: {model: 'gpt-6-luna', thinking: 'low'}},
      'slack-dispatcher': {route: {model: 'gpt-6-luna', thinking: 'high'}},
      'slack-to-ticket': {draft: {model: 'gpt-6-sol', thinking: 'high'}},
      'ticket-to-pr': {
        fix: {model: 'gpt-6-luna', thinking: 'max'},
        reply: {model: 'glm-5.3-flash', thinking: 'low'},
      },
    };

    for (const template of loadShippedTemplates()) {
      for (const bindings of templateRoleBindings(template.manifest.roles)) {
        expect(extractModelAnchors(composeTemplate(template, bindings))).toEqual(
          expected[template.id as keyof typeof expected],
        );
      }
    }
  });

  it('gives every shipped template its catalog metadata', () => {
    const templates = loadShippedTemplates();
    const packages = new Set(templates.map(({id}) => `shipfox/${id}`));

    for (const {id, manifest} of templates) {
      expect(manifest.keywords, id).not.toHaveLength(0);
      expect(manifest.flow[0]?.kind, id).toBe('trigger');
      expect(manifest.writes, id).not.toHaveLength(0);
      for (const related of manifest.related) {
        expect(packages, `${id} links ${related}`).toContain(related);
      }
    }
  });

  it('leaves writes and prerequisites to the manifest, not the guides', () => {
    for (const {id, guide} of loadShippedTemplates()) {
      expect(guide, id).not.toMatch(guideWritesSectionPattern);
    }
  });

  it('applies every option choice over the defaults to a valid workflow for every role combination', () => {
    for (const template of loadShippedTemplates()) {
      const defaults = Object.fromEntries(
        template.manifest.options.map((option) => [option.id, defaultChoice(option)]),
      );
      const selections = [
        defaults,
        ...template.manifest.options.flatMap((option) =>
          option.choices.map((choice) => ({...defaults, [option.id]: choice.id})),
        ),
      ];

      for (const bindings of templateRoleBindings(template.manifest.roles)) {
        const composed = composeTemplate(template, bindings);
        for (const selection of selections) {
          const applied = applyTemplateOptions(composed, selection);
          const label = `${template.id} ${JSON.stringify(bindings)} ${JSON.stringify(selection)}`;

          expect(applied, label).not.toMatch(optionBlockMarkerPattern);
          expect(() => parseWorkflowDocument(parseYaml(applied)), label).not.toThrow();
        }
      }
    }
  });

  it('keeps embedded compatibility metadata beside each manifest', () => {
    expect(
      Object.fromEntries(
        loadShippedTemplates().map(({id, revision, added_at, rank, manifest}) => [
          id,
          {revision, added_at, rank, manifestHasIdentity: 'id' in manifest},
        ]),
      ),
    ).toEqual({
      'ask-codebase': {
        revision: 1,
        added_at: '2026-09-26',
        rank: 2,
        manifestHasIdentity: false,
      },
      'fix-default-branch-ci': {
        revision: 1,
        added_at: '2026-09-26',
        rank: 4,
        manifestHasIdentity: false,
      },
      'fix-dependency-ci': {
        revision: 3,
        added_at: '2026-09-22',
        rank: 5,
        manifestHasIdentity: false,
      },
      'report-failed-runs': {
        revision: 1,
        added_at: '2026-09-26',
        rank: 6,
        manifestHasIdentity: false,
      },
      'slack-dispatcher': {
        revision: 1,
        added_at: '2026-09-28',
        rank: 7,
        manifestHasIdentity: false,
      },
      'slack-to-ticket': {
        revision: 1,
        added_at: '2026-09-27',
        rank: 3,
        manifestHasIdentity: false,
      },
      'ticket-to-pr': {
        revision: 7,
        added_at: '2026-09-23',
        rank: 1,
        manifestHasIdentity: false,
      },
    });
  });

  it('composes and parses every shipped role combination within the payload limit', () => {
    for (const template of loadShippedTemplates()) {
      for (const bindings of templateRoleBindings(template.manifest.roles)) {
        const composed = composeTemplate(template, bindings);

        parseWorkflowDocument(parseYaml(composed));
        expect(Buffer.byteLength(composed, 'utf8')).toBeLessThan(64 * 1024);
      }
    }
  });

  it.each([
    {
      name: 'a manifest placeholder without a marker',
      template: () => {
        const template = shippedTemplate('fix-dependency-ci');
        return withFixPart(template, (block) => block.replace(' # model:fix', ''));
      },
      message: 'models.fix has no # model:fix marker',
    },
    {
      name: 'a marker without a manifest placeholder',
      template: () => {
        const template = shippedTemplate('fix-dependency-ci');
        return withFixPart(template, (block) => block.replace('# model:fix', '# model:unknown'));
      },
      message: '# model:unknown has no manifest placeholder',
    },
    {
      name: 'a marked step without thinking',
      template: () => {
        const template = shippedTemplate('fix-dependency-ci');
        return withSourcePart(template, 'fix', (block) =>
          block.replace(missingThinkingPattern, ''),
        );
      },
      message: 'Model marker has no sibling thinking field',
    },
    {
      name: 'conflicting markers for one placeholder',
      template: () => {
        const template = shippedTemplate('ticket-to-pr');
        return withSourcePart(template, 'respond', (block) =>
          block.replace('gpt-6-luna # model:fix', 'gpt-6-sol # model:fix'),
        );
      },
      message: 'Conflicting model anchor for placeholder fix',
    },
  ])('rejects $name', ({
    template,
    message,
  }: {
    template: () => WorkflowTemplate;
    message: string;
  }) => {
    expect(() => createTemplateLoader([template()])).toThrow(message);
  });

  it('derives whether every role binding starts manually', () => {
    expect(
      Object.fromEntries(
        loadShippedTemplates().map((template) => [template.id, template.startsManually]),
      ),
    ).toEqual({
      'ask-codebase': true,
      'fix-default-branch-ci': false,
      'fix-dependency-ci': false,
      'report-failed-runs': false,
      'slack-dispatcher': false,
      'slack-to-ticket': true,
      'ticket-to-pr': true,
    });
  });

  it('does not start manually when only an optional role adds the manual trigger', () => {
    const template = shippedTemplate('fix-default-branch-ci');
    const withManualReport: WorkflowTemplateAsset = {
      ...template,
      workflow: template.workflow.replace(
        '  # part:source.trigger\n',
        '  # part:source.trigger\n  # part:report.trigger\n',
      ),
      parts: {
        ...template.parts,
        report: {
          slack: {...template.parts.report?.slack, trigger: 'manual:\n  source: manual'},
        },
      },
    };

    const [loaded] = createTemplateLoader([withManualReport]).list();

    expect(withManualReport.workflow).toContain('# part:report.trigger');
    expect(loaded?.startsManually).toBe(false);
  });

  it('keeps setup command insertion inside job steps', () => {
    const loader = createTemplateLoader([fixture]);
    const template = loader.get('fixture-ticket-to-pr');
    if (template === undefined) throw new Error('Fixture template was not loaded');
    const composed = composeTemplate(template, {tracker: 'linear', source: 'github'});
    const setupSlot = '      # slot:setup_commands';

    expect(composed).toContain(setupSlot);
    const withSetupCommand = composed.replace(
      setupSlot,
      '      - key: setup\n        run: pnpm install',
    );

    parseWorkflowDocument(parseYaml(withSetupCommand));
  });
});

function shippedTemplate(id: string): WorkflowTemplate {
  const template = loadShippedTemplates().find((candidate) => candidate.id === id);
  if (template === undefined) throw new Error(`Shipped template was not loaded: ${id}`);
  return template;
}

function withFixPart(
  template: WorkflowTemplate,
  transform: (block: string) => string,
): WorkflowTemplate {
  return withSourcePart(template, 'fix', transform);
}

function withSourcePart(
  template: WorkflowTemplate,
  partName: string,
  transform: (block: string) => string,
): WorkflowTemplate {
  const sourceParts = template.parts.source;
  const githubParts = sourceParts?.github;
  const part = githubParts?.[partName];
  if (sourceParts === undefined || githubParts === undefined || part === undefined) {
    throw new Error(`${template.id} has no source.github.${partName} part`);
  }

  return {
    ...template,
    parts: {
      ...template.parts,
      source: {
        ...sourceParts,
        github: {...githubParts, [partName]: transform(part)},
      },
    },
  };
}
