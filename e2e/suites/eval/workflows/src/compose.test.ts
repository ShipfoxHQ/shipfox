import {fileURLToPath} from 'node:url';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {composeCaseWorkflow, fillSlots, setRunnerLabel, templateLoaderFor} from './compose.js';
import {discoverCases} from './discovery.js';

const noMarkerPattern = /no marker for slot missing/u;
const ownerPattern = /replace-with-owner\/repository/u;
const unfilledPattern = /replace-with-test-command/u;
const noRunnerPattern = /no `runner: shipfox`/u;
const unknownTemplatePattern = /does not serve shipfox\/unknown/u;

describe('fillSlots', () => {
  it('replaces a marker alone on its line with the value at the marker indentation', () => {
    const yaml = ['steps:', '      # slot:setup', '      - key: after'].join('\n');

    const filled = fillSlots({yaml, slots: {setup: '- key: setup\n  run: npm ci'}});

    expect(filled).toBe(
      ['steps:', '      - key: setup', '        run: npm ci', '      - key: after'].join('\n'),
    );
  });

  it('replaces the placeholder in a line that ends with the marker', () => {
    const yaml = '          { replace-with-test-command; } # slot:test_command';

    const filled = fillSlots({yaml, slots: {test_command: 'npm test'}});

    expect(filled).toBe('          { npm test; }');
  });

  it('fails when a slot has no marker in the workflow', () => {
    expect(() => fillSlots({yaml: 'name: none', slots: {missing: 'x'}})).toThrow(noMarkerPattern);
  });

  it('rejects a placeholder that contains a slash', () => {
    const yaml = 'repo: replace-with-owner/repository';

    expect(() => fillSlots({yaml, slots: {}})).toThrow(ownerPattern);
  });

  it('fails when a placeholder is left unfilled', () => {
    const yaml = '{ replace-with-test-command; } # slot:test_command';

    expect(() => fillSlots({yaml, slots: {}})).toThrow(unfilledPattern);
  });
});

describe('setRunnerLabel', () => {
  it('sends every shipfox runner to the case label', () => {
    const yaml = ['runner: shipfox', 'jobs:', '  a:', '    runner: shipfox'].join('\n');

    expect(setRunnerLabel({yaml, label: 'eval-1'})).toBe(
      ['runner: eval-1', 'jobs:', '  a:', '    runner: eval-1'].join('\n'),
    );
  });

  it('fails when the workflow has no shipfox runner', () => {
    expect(() => setRunnerLabel({yaml: 'runner: other', label: 'eval-1'})).toThrow(noRunnerPattern);
  });
});

describe('composeCaseWorkflow', () => {
  it('composes the fixture case through the directory loader with its slots and runner label', async () => {
    const [fixture] = await discoverCases(
      fileURLToPath(new URL('../cases/templates/', import.meta.url)),
      {filter: 'fixture'},
    );
    if (!fixture) throw new Error('The fixture case is missing.');

    const yaml = await composeCaseWorkflow({
      templateCase: fixture.definition,
      loader: templateLoaderFor({
        templateCase: fixture.definition,
        caseDirectory: fixture.directory,
      }),
      runnerLabel: 'eval-abc',
    });

    expect(yaml).toContain('runner: eval-abc');
    expect(yaml).toContain('# shipfox-template: fixture@1 source=github');
    expect(yaml).toContain('contents: read');
    expect(yaml).toContain('run: test -f package.json');
    expect(yaml).toContain('{ test -f src/greeting.txt; }');
  });

  it('fails when the loader does not serve the template', async () => {
    const [fixture] = await discoverCases(
      fileURLToPath(new URL('../cases/templates/', import.meta.url)),
      {filter: 'fixture'},
    );
    if (!fixture) throw new Error('The fixture case is missing.');

    await expect(
      composeCaseWorkflow({
        templateCase: {...fixture.definition, template: 'shipfox/unknown'},
        loader: templateLoaderFor({
          templateCase: fixture.definition,
          caseDirectory: fixture.directory,
        }),
        runnerLabel: 'eval-abc',
      }),
    ).rejects.toThrow(unknownTemplatePattern);
  });
});
