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
