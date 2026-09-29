import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  applyTemplateOptions,
  composeTemplate,
  composeWorkflow,
  templateRoleBindings,
  templateVariants,
} from './composer.js';
import {SUPPORTED_COMPOSITIONS, UnsupportedCompositionError} from './composition.js';
import {parseTemplateHeader} from './header.js';
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
    id: 'fixture',
    revision: 2,
    manifest: workflowTemplateManifestSchema.parse({
      title: 'Fixture',
      summary: 'A fixture template.',
      starts: 'A test event starts this workflow',
      roles: {
        report: {
          providers: ['slack'],
          optional: true,
          question: 'Should the workflow report to Slack?',
          tradeoff: 'Posts one Slack message per run.',
        },
        source: {from: 'project', providers: ['github']},
      },
      options: [
        {id: 'mode', choices: [{id: 'fast', default: true}, {id: 'thorough'}]},
        {id: 'report', choices: [{id: 'daily'}, {id: 'weekly'}]},
      ],
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

  describe('registry header', () => {
    const header = {
      kind: 'registry',
      reference: {namespace: 'shipfox', name: 'fixture', version: '1.2.0'},
    } as const;

    it('writes bound roles and then chosen options, each in manifest order', () => {
      const composed = composeTemplate(
        template,
        {source: 'github', report: 'slack'},
        {header, options: {report: 'weekly', mode: 'thorough'}},
      );

      expect(composed.split('\n')[1]).toBe(
        '# shipfox-template: shipfox/fixture@1.2.0; roles: report=slack source=github; options: mode=thorough report=weekly',
      );
    });

    it('omits an empty group', () => {
      expect(composeTemplate(template, {source: 'github'}, {header}).split('\n')[1]).toBe(
        '# shipfox-template: shipfox/fixture@1.2.0; roles: source=github',
      );
      expect(
        composeTemplate(template, {source: 'github'}, {header, options: {mode: 'fast'}}).split(
          '\n',
        )[1],
      ).toBe('# shipfox-template: shipfox/fixture@1.2.0; roles: source=github; options: mode=fast');
    });

    it('parses back to the reference, bindings, and options that were written', () => {
      const composed = composeTemplate(
        template,
        {source: 'github', report: 'slack'},
        {header, options: {report: 'daily'}},
      );

      expect(parseTemplateHeader(composed)).toEqual({
        ref: {namespace: 'shipfox', name: 'fixture', version: '1.2.0'},
        bindings: {report: 'slack', source: 'github'},
        options: {report: 'daily'},
      });
    });

    it('changes only the header line', () => {
      const bindings = {source: 'github', report: 'slack'};
      const legacy = composeTemplate(template, bindings).split('\n');
      const registry = composeTemplate(template, bindings, {header}).split('\n');

      expect(registry.filter((_, index) => index !== 1)).toEqual(
        legacy.filter((_, index) => index !== 1),
      );
    });

    it('rejects a reference the parser would not accept', () => {
      expect(() =>
        composeTemplate(
          template,
          {source: 'github'},
          {header: {...header, reference: {...header.reference, version: '^1.2.0'}}},
        ),
      ).toThrow('Invalid registry reference for the template header');
    });
  });

  describe('options', () => {
    it('leaves them out of a legacy header', () => {
      const composed = composeTemplate(template, {source: 'github'}, {options: {mode: 'fast'}});

      expect(composed.split('\n')[1]).toBe('# shipfox-template: fixture@2 source=github');
    });

    it('rejects an option the manifest does not declare', () => {
      expect(() =>
        composeTemplate(template, {source: 'github'}, {options: {speed: 'fast'}}),
      ).toThrow('fixture: unknown option speed');
    });

    it('rejects a choice the option does not declare', () => {
      expect(() =>
        composeTemplate(template, {source: 'github'}, {options: {mode: 'slow'}}),
      ).toThrow('fixture: unsupported choice for option mode: slow');
    });
  });

  it('lists every binding with each optional role bound and unbound', () => {
    expect(templateRoleBindings(template.manifest.roles)).toEqual([
      {source: 'github'},
      {report: 'slack', source: 'github'},
    ]);
  });

  it('lists default bindings and each non-default option choice', () => {
    expect(templateVariants(template)).toEqual([
      {bindings: {source: 'github'}, options: {mode: 'fast', report: 'daily'}},
      {
        bindings: {report: 'slack', source: 'github'},
        options: {mode: 'fast', report: 'daily'},
      },
      {
        bindings: {report: 'slack', source: 'github'},
        options: {mode: 'thorough', report: 'daily'},
      },
      {
        bindings: {report: 'slack', source: 'github'},
        options: {mode: 'fast', report: 'weekly'},
      },
    ]);
  });
});

const optionModeMarkerPattern = /# option:mode/;

describe('applyTemplateOptions', () => {
  const workflow = [
    '# shipfox-template: shipfox/fixture@1.2.0; roles: source=github; options: mode=fast',
    'jobs:',
    '  build:',
    '    # bind:source',
    '    # slot:test_command',
    '    # option:bot_identity',
    '    steps:',
    '      # option:mode=fast begin',
    '      - key: quick',
    '      # option:mode=fast end',
    '      # option:mode=thorough begin',
    '      - key: deep',
    '      # option:mode=thorough end',
    '      # option:mode=thorough,both begin',
    '      - key: deep_or_both',
    '      # option:mode=thorough,both end',
    '      # option:mode=fast,both begin',
    '      - key: fast_or_both',
    '      # option:mode=fast,both end',
    '      - key: always',
  ].join('\n');

  it('keeps the chosen block and deletes the other blocks of that option', () => {
    expect(applyTemplateOptions(workflow, {mode: 'thorough'})).toBe(
      [
        '# shipfox-template: shipfox/fixture@1.2.0; roles: source=github; options: mode=fast',
        'jobs:',
        '  build:',
        '    # bind:source',
        '    # slot:test_command',
        '    # option:bot_identity',
        '    steps:',
        '      - key: deep',
        '      - key: deep_or_both',
        '      - key: always',
      ].join('\n'),
    );
  });

  it('keeps a block that lists the chosen choice among several', () => {
    const applied = applyTemplateOptions(workflow, {mode: 'fast'});

    expect(applied).toContain('      - key: quick');
    expect(applied).toContain('      - key: fast_or_both');
    expect(applied).not.toContain('deep');
  });

  it('removes every begin and end marker but keeps other comments', () => {
    const applied = applyTemplateOptions(workflow, {mode: 'fast'});

    expect(applied).not.toMatch(optionModeMarkerPattern);
    expect(applied).toContain('# bind:source');
    expect(applied).toContain('# slot:test_command');
    expect(applied).toContain('# option:bot_identity');
  });

  it('deletes every block when the option has a choice none of them lists', () => {
    expect(applyTemplateOptions(workflow, {mode: 'unlisted'})).toBe(
      [
        '# shipfox-template: shipfox/fixture@1.2.0; roles: source=github; options: mode=fast',
        'jobs:',
        '  build:',
        '    # bind:source',
        '    # slot:test_command',
        '    # option:bot_identity',
        '    steps:',
        '      - key: always',
      ].join('\n'),
    );
  });

  it('keeps the blocks and markers of an option that has no choice', () => {
    expect(applyTemplateOptions(workflow, {})).toBe(workflow);
    expect(applyTemplateOptions(workflow, {other: 'x'})).toBe(workflow);
  });

  it('applies options to their own blocks when blocks of different options nest', () => {
    const nested = [
      'a: 1',
      '# option:outer=on begin',
      'b: 2',
      '  # option:inner=left begin',
      'c: 3',
      '  # option:inner=left end',
      '  # option:inner=right begin',
      'd: 4',
      '  # option:inner=right end',
      '# option:outer=on end',
    ].join('\n');

    expect(applyTemplateOptions(nested, {outer: 'on', inner: 'right'})).toBe('a: 1\nb: 2\nd: 4');
    expect(applyTemplateOptions(nested, {outer: 'off', inner: 'right'})).toBe('a: 1');
  });

  it('does not read an inherited property as a chosen option', () => {
    const block = '# option:constructor=on begin\nx\n# option:constructor=on end';

    expect(applyTemplateOptions(block, {})).toBe(block);
  });

  it('fails on unbalanced blocks', () => {
    expect(() => applyTemplateOptions('# option:mode=fast begin\nx', {mode: 'fast'})).toThrow(
      'Unclosed option block: # option:mode=fast begin',
    );
    expect(() => applyTemplateOptions('x\n# option:mode=fast end', {mode: 'fast'})).toThrow(
      'Unbalanced option block: # option:mode=fast end',
    );
    expect(() =>
      applyTemplateOptions('# option:mode=fast begin\n# option:mode=thorough end', {mode: 'fast'}),
    ).toThrow('Unbalanced option block: # option:mode=thorough end');
  });
});

describe('composition formats', () => {
  const manifest = workflowTemplateManifestSchema.parse({
    title: 'Fixture',
    summary: 'A fixture template.',
    starts: 'A test event starts this workflow',
    roles: {source: {from: 'project', providers: ['github']}},
  });
  const template = {
    id: 'fixture',
    revision: 1,
    manifest,
    workflow: 'name: fixture\n# part:source.checkout',
    parts: {source: {github: {checkout: 'checkout: true'}}},
  };

  it('supports format 1', () => {
    expect(SUPPORTED_COMPOSITIONS).toEqual([1]);
  });

  it('composes the same output for the default and an explicit supported format', () => {
    expect(composeTemplate(template, {source: 'github'}, {composition: 1})).toBe(
      composeTemplate(template, {source: 'github'}),
    );
    expect(applyTemplateOptions('a', {}, {composition: 1})).toBe('a');
  });

  it('rejects an unsupported format', () => {
    expect(() => composeTemplate(template, {source: 'github'}, {composition: 2})).toThrow(
      UnsupportedCompositionError,
    );
    expect(() => applyTemplateOptions('a', {}, {composition: 0})).toThrow(
      'Unsupported template composition 0; supported: 1',
    );
  });
});
