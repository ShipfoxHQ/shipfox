import {execFile} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {extractModelAnchors, validateModelAnchors} from './model-anchors.js';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = {
  id: 'fixture',
  models: {
    ticket: {},
    fix: {},
  },
};

describe('extractModelAnchors', () => {
  it('extracts model and thinking from marked steps in composed YAML', () => {
    const anchors = extractModelAnchors(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - key: ticket',
        '        model: ticket-model # model:ticket',
        '        thinking: medium',
        '      - key: fix',
        '        model: fix-model # model:fix',
        '        thinking: max',
      ].join('\n'),
    );

    expect(anchors).toEqual({
      ticket: {model: 'ticket-model', thinking: 'medium'},
      fix: {model: 'fix-model', thinking: 'max'},
    });
  });

  it('finds markers in provider parts after they are composed', () => {
    const anchors = extractModelAnchors(
      ['- key: ticket', '  model: provider-model # model:ticket', '  thinking: high'].join('\n'),
    );

    expect(anchors).toEqual({ticket: {model: 'provider-model', thinking: 'high'}});
  });

  it('parses quoted YAML thinking scalars', () => {
    const anchors = extractModelAnchors(
      ['model: tested # model:ticket', 'thinking: "high"'].join('\n'),
    );

    expect(anchors).toEqual({ticket: {model: 'tested', thinking: 'high'}});
  });

  it('surfaces malformed YAML before scanning model anchors', () => {
    expect(() =>
      extractModelAnchors(
        ['model: tested # model:ticket', 'thinking: high', 'malformed: [unterminated'].join('\n'),
      ),
    ).toThrow('Invalid composed YAML: Flow sequence in block collection');
  });

  it('ignores model-looking text inside prompt block scalars', () => {
    const anchors = extractModelAnchors(
      [
        'steps:',
        '  - key: ticket',
        '    model: tested # model:ticket',
        '    thinking: high',
        '    prompt: |',
        '      This prompt contains # model:not-an-anchor.',
        '      model: also-not-an-anchor # model:ignored',
      ].join('\n'),
    );

    expect(anchors).toEqual({ticket: {model: 'tested', thinking: 'high'}});
  });

  it('does not borrow thinking from a separated sequence item', () => {
    expect(() =>
      extractModelAnchors(
        [
          'steps:',
          '  - key: ticket',
          '    model: tested # model:ticket',
          '',
          '    # A comment must not bridge the step boundary.',
          '  - key: next',
          '    thinking: high',
        ].join('\n'),
      ),
    ).toThrow('Model marker has no sibling thinking field');
  });

  it('rejects an empty model value', () => {
    expect(() =>
      extractModelAnchors(['model: # model:ticket', 'thinking: high'].join('\n')),
    ).toThrow('Model marker has no model or placeholder');
  });

  it('supports prototype-key placeholders', () => {
    const anchors = extractModelAnchors(
      ['model: tested # model:constructor', 'thinking: high'].join('\n'),
    );
    const models = Object.create(null) as Record<string, object>;
    Object.defineProperty(models, 'constructor', {value: {}, enumerable: true});
    Object.defineProperty(models, 'toString', {value: {}, enumerable: true});

    expect(anchors.constructor).toEqual({model: 'tested', thinking: 'high'});
    expect(() =>
      validateModelAnchors(
        {id: 'fixture', models},
        ['model: tested # model:constructor', 'thinking: high'].join('\n'),
      ),
    ).toThrow('models.toString has no # model:toString marker');
  });

  it('rejects a marked step without thinking', () => {
    expect(() => extractModelAnchors('model: tested # model:ticket')).toThrow(
      'Model marker has no sibling thinking field',
    );
  });

  it('rejects conflicting markers for one placeholder', () => {
    expect(() =>
      extractModelAnchors(
        [
          'model: first # model:ticket',
          'thinking: high',
          'model: second # model:ticket',
          'thinking: high',
        ].join('\n'),
      ),
    ).toThrow('Conflicting model anchor for placeholder ticket');
  });
});

describe('asset validation', () => {
  it('surfaces malformed YAML before validating embedded assets', async () => {
    const temporaryRoot = await mkdtemp(join(packageRoot, '.tmp-embed-assets-'));

    try {
      await Promise.all([
        mkdir(join(temporaryRoot, 'scripts'), {recursive: true}),
        mkdir(join(temporaryRoot, 'src/generated'), {recursive: true}),
      ]);
      await Promise.all([
        cp(join(packageRoot, 'assets'), join(temporaryRoot, 'assets'), {recursive: true}),
        cp(
          join(packageRoot, 'scripts/embed-assets.mjs'),
          join(temporaryRoot, 'scripts/embed-assets.mjs'),
        ),
        cp(join(packageRoot, 'package.json'), join(temporaryRoot, 'package.json')),
      ]);

      const workflowPath = join(temporaryRoot, 'assets/ticket-to-pr/workflow.yml');
      await writeFile(
        workflowPath,
        `${await readFile(workflowPath, 'utf8')}\nmalformed: [unterminated\n`,
      );

      await expect(
        execFileAsync(process.execPath, [join(temporaryRoot, 'scripts/embed-assets.mjs')], {
          cwd: temporaryRoot,
        }),
      ).rejects.toThrow('Invalid composed YAML: Flow sequence in block collection');
    } finally {
      await rm(temporaryRoot, {recursive: true, force: true});
    }
  });
});

describe('validateModelAnchors', () => {
  it('rejects a manifest placeholder without a marker', () => {
    expect(() =>
      validateModelAnchors(manifest, 'model: tested # model:ticket\nthinking: high'),
    ).toThrow('models.fix has no # model:fix marker');
  });

  it('rejects a marker without a manifest placeholder', () => {
    expect(() =>
      validateModelAnchors(
        {...manifest, models: {ticket: {}}},
        'model: tested # model:unknown\nthinking: high',
      ),
    ).toThrow('# model:unknown has no manifest placeholder');
  });
});
