import {readFileSync} from 'node:fs';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import type {PartBlocks} from './composer.js';
import {composeTemplate} from './composer.js';
import type {WorkflowTemplateAsset} from './loader.js';
import {createTemplateLoader, loadShippedTemplates} from './loader.js';
import {type WorkflowTemplateManifest, workflowTemplateManifestSchema} from './manifest.js';
import {extractModelAnchors} from './model-anchors.js';

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

  it('composes and parses every shipped role combination within the payload limit', () => {
    for (const template of loadShippedTemplates()) {
      for (const bindings of roleBindings(template.manifest.roles)) {
        const composed = composeTemplate(template, bindings);

        parseWorkflowDocument(parseYaml(composed));
        expect(Buffer.byteLength(composed, 'utf8')).toBeLessThan(64 * 1024);
      }
    }
  });

  it('extracts anchors from every shipped role combination', () => {
    for (const template of loadShippedTemplates()) {
      for (const bindings of roleBindings(template.manifest.roles)) {
        const anchors = extractModelAnchors(composeTemplate(template, bindings));

        if (template.manifest.id === 'ticket-to-pr') {
          expect(anchors).toEqual({
            ticket: {model: 'gpt-6-luna', thinking: 'max'},
            fix: {model: 'gpt-6-luna', thinking: 'max'},
            review: {model: 'gpt-6-luna', thinking: 'max'},
          });
        } else {
          expect(anchors).toEqual({fix: {model: 'gpt-6-sol', thinking: 'high'}});
        }
      }
    }
  });

  it('rejects a manifest placeholder without a model marker', () => {
    expect(() =>
      createTemplateLoader([
        {
          ...fixture,
          manifest: {...(fixture.manifest as WorkflowTemplateManifest), models: {fix: {}}},
        },
      ]),
    ).toThrow('missing a model marker for "fix"');
  });

  it('rejects a model marker for an undeclared placeholder', () => {
    expect(() =>
      createTemplateLoader([
        {
          ...fixture,
          workflow: fixture.workflow.replace(
            '      # slot:setup_commands',
            '      - key: marked\n        model: tested # model:extra\n        thinking: max',
          ),
        },
      ]),
    ).toThrow('model marker for undeclared placeholder "extra"');
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

function roleBindings(roles: WorkflowTemplateManifest['roles']): Record<string, string>[] {
  return Object.entries(roles).reduce<Record<string, string>[]>(
    (bindings, [role, declaration]) =>
      bindings.flatMap((binding) =>
        declaration.providers.map((provider) => ({...binding, [role]: provider})),
      ),
    [{}],
  );
}
