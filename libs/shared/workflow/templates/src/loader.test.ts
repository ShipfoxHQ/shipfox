import {readFileSync} from 'node:fs';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {parseWorkflowDocument} from '@shipfox/workflow-document';
import {parse as parseYaml} from 'yaml';
import type {PartProviderBlocks} from './composer.js';
import {composeTemplate} from './composer.js';
import type {WorkflowTemplateAsset} from './loader.js';
import {createTemplateLoader, loadShippedTemplates} from './loader.js';
import {workflowTemplateManifestSchema} from './manifest.js';

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

function parsePart(path: string): PartProviderBlocks[string][string] {
  return parseYaml(
    readFileSync(new URL(path, fixtureRoot), 'utf8'),
  ) as PartProviderBlocks[string][string];
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
    expect(loadShippedTemplates()).toHaveLength(0);
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
