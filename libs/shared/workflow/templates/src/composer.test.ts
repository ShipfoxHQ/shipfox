import {describe, expect, it} from '@shipfox/vitest/vi';
import {composeTemplate, composeWorkflow, templateRoleBindings} from './composer.js';
import {workflowTemplateManifestSchema} from './manifest.js';

describe('composeWorkflow', () => {
  it('replaces markers at their indentation and keeps surrounding comments', () => {
    const composed = composeWorkflow(
      [
        'jobs:',
        '  build:',
        '    # bind:source',
        '    # part:source.checkout',
        '    # slot:test_command',
        '    # option:mode=fast begin',
        '    # option:mode=fast end',
      ].join('\n'),
      {checkout: '- key: checkout\n  prompt: Check out the repository.'},
    );

    expect(composed).toBe(
      [
        'jobs:',
        '  build:',
        '    # bind:source',
        '    - key: checkout',
        '      prompt: Check out the repository.',
        '    # slot:test_command',
        '    # option:mode=fast begin',
        '    # option:mode=fast end',
      ].join('\n'),
    );
  });

  it('fails when a marker has no matching part', () => {
    expect(() => composeWorkflow('# part:tracker.trigger', {})).toThrow(
      'Missing workflow template part: tracker.trigger',
    );
  });
});

describe('composeTemplate', () => {
  const template = {
    manifest: workflowTemplateManifestSchema.parse({
      id: 'fixture',
      revision: 2,
      added_at: '2026-10-01',
      rank: 1,
      title: 'Fixture',
      summary: 'A fixture template.',
      roles: {
        report: {
          providers: ['slack'],
          optional: true,
          question: 'Should the workflow report to Slack?',
          tradeoff: 'Posts one Slack message per run.',
        },
        source: {from: 'project', providers: ['github']},
      },
    }),
    workflow: [
      '# yaml-language-server: $schema=https://www.shipfox.io/docs/workflow.schema.json',
      'name: fixture',
      'jobs:',
      '  build:',
      '    # part:source.checkout',
      '  # part:report.job',
    ].join('\n'),
    parts: {
      source: {github: {checkout: 'checkout: true'}},
      report: {slack: {job: 'report:\n  needs: build'}},
    },
  };

  it('writes the header from the bound roles in manifest order', () => {
    expect(composeTemplate(template, {source: 'github', report: 'slack'})).toBe(
      [
        '# yaml-language-server: $schema=https://www.shipfox.io/docs/workflow.schema.json',
        '# shipfox-template: fixture@2 report=slack source=github',
        'name: fixture',
        'jobs:',
        '  build:',
        '    checkout: true',
        '  report:',
        '    needs: build',
      ].join('\n'),
    );
  });

  it('drops the parts of an unbound optional role and leaves it out of the header', () => {
    expect(composeTemplate(template, {source: 'github'})).toBe(
      [
        '# yaml-language-server: $schema=https://www.shipfox.io/docs/workflow.schema.json',
        '# shipfox-template: fixture@2 source=github',
        'name: fixture',
        'jobs:',
        '  build:',
        '    checkout: true',
      ].join('\n'),
    );
  });

  it('fails when a required role is unbound', () => {
    expect(() => composeTemplate(template, {report: 'slack'})).toThrow(
      'Missing provider binding for workflow template role: source',
    );
  });

  it('fails when the base workflow declares its own header', () => {
    expect(() =>
      composeTemplate(
        {...template, workflow: `# shipfox-template: fixture@2\n${template.workflow}`},
        {source: 'github'},
      ),
    ).toThrow('The base workflow must not declare # shipfox-template');
  });

  it('lists every binding with each optional role bound and unbound', () => {
    expect(templateRoleBindings(template.manifest.roles)).toEqual([
      {source: 'github'},
      {report: 'slack', source: 'github'},
    ]);
  });
});
