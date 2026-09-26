import {readFileSync} from 'node:fs';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import type {PartBlocks} from './composer.js';
import {composeTemplate} from './composer.js';
import type {WorkflowTemplate, WorkflowTemplateAsset} from './loader.js';
import {createTemplateLoader, loadShippedTemplates} from './loader.js';
import {type WorkflowTemplateManifest, workflowTemplateManifestSchema} from './manifest.js';
import {extractModelAnchors} from './model-anchors.js';

const missingThinkingPattern = /thinking: high\s*/u;
const fixtureRoot = new URL('../test/fixtures/', import.meta.url);
const fixture: WorkflowTemplateAsset = {
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
    expect(loadShippedTemplates().map((template) => template.manifest.id)).toEqual([
      'fix-dependency-ci',
      'ticket-to-pr',
    ]);
  });

  it('extracts anchors from every shipped role combination', () => {
    const expected = {
      'fix-dependency-ci': {fix: {model: 'gpt-6-sol', thinking: 'high'}},
      'ticket-to-pr': {
        fix: {model: 'gpt-6-luna', thinking: 'high'},
        reply: {model: 'gpt-6-sol', thinking: 'low'},
      },
    };

    for (const template of loadShippedTemplates()) {
      for (const bindings of roleBindings(template.manifest.roles)) {
        expect(extractModelAnchors(composeTemplate(template, bindings))).toEqual(
          expected[template.manifest.id as keyof typeof expected],
        );
      }
    }
  });

  it('composes and parses every shipped role combination within the payload limit', () => {
    for (const template of loadShippedTemplates()) {
      for (const bindings of roleBindings(template.manifest.roles)) {
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
  const template = loadShippedTemplates().find((candidate) => candidate.manifest.id === id);
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
    throw new Error(`${template.manifest.id} has no source.github.${partName} part`);
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

function roleBindings(roles: WorkflowTemplateManifest['roles']): Record<string, string>[] {
  return Object.entries(roles).reduce<Record<string, string>[]>(
    (bindings, [role, declaration]) =>
      bindings.flatMap((binding) =>
        declaration.providers.map((provider) => ({...binding, [role]: provider})),
      ),
    [{}],
  );
}
