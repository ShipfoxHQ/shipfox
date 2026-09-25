import {describe, expect, it} from '@shipfox/vitest/vi';
import {extractModelAnchors, validateModelAnchors} from './model-anchors.js';

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
