import {describe, expect, it} from '@shipfox/vitest/vi';
import {extractModelAnchors} from './model-anchors.js';

describe('extractModelAnchors', () => {
  it('reads markers from nested steps and keeps one anchor per placeholder', () => {
    const anchors = extractModelAnchors(`
      jobs:
        implement:
          steps:
            - key: ticket
              model: gpt-6-luna # model:ticket
              thinking: max
            - key: fix
              model: gpt-6-luna # model:fix
              thinking: max
            - key: review
              model: gpt-6-luna # model:review
              thinking: max
    `);

    expect(anchors).toEqual({
      ticket: {model: 'gpt-6-luna', thinking: 'max'},
      fix: {model: 'gpt-6-luna', thinking: 'max'},
      review: {model: 'gpt-6-luna', thinking: 'max'},
    });
  });

  it('allows repeated matching markers for one placeholder', () => {
    const anchors = extractModelAnchors(`
      jobs:
        first:
          steps:
            - model: gpt-6-luna # model:fix
              thinking: max
        second:
          steps:
            - model: gpt-6-luna # model:fix
              thinking: max
    `);

    expect(anchors).toEqual({fix: {model: 'gpt-6-luna', thinking: 'max'}});
  });

  it('rejects a marked step without thinking', () => {
    expect(() => extractModelAnchors('model: gpt-6-luna # model:fix')).toThrow(
      'Marked model step "fix" is missing thinking',
    );
  });

  it.each([
    ['model', 'gpt-6-sol', 'max'],
    ['thinking', 'gpt-6-luna', 'high'],
  ])('rejects markers that disagree on %s', (_field, model, thinking) => {
    expect(() =>
      extractModelAnchors(`
        jobs:
          first:
            model: gpt-6-luna # model:fix
            thinking: max
          second:
            model: ${model} # model:fix
            thinking: ${thinking}
      `),
    ).toThrow('Conflicting model anchors for "fix"');
  });
});
