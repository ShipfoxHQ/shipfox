import {labelsSatisfiedBy, rankTemplatesForLabels, selectTemplate} from '#template-selection.js';
import type {ProvisionerTemplate} from '#types.js';

function template(
  overrides: Partial<ProvisionerTemplate<null>> & {key: string},
): ProvisionerTemplate<null> {
  return {
    labels: ['ubuntu22'],
    maxConcurrency: 10,
    cost: 1,
    spec: null,
    ...overrides,
  };
}

describe('labelsSatisfiedBy', () => {
  it('matches when every required label is offered', () => {
    const matched = labelsSatisfiedBy(['ubuntu22'], ['ubuntu22', 'ubuntu22-4cpu']);

    expect(matched).toBe(true);
  });

  it('does not match when a required label is missing', () => {
    const matched = labelsSatisfiedBy(['ubuntu22', 'ubuntu22-8cpu'], ['ubuntu22', 'ubuntu22-4cpu']);

    expect(matched).toBe(false);
  });

  it('ignores order and extra offered labels', () => {
    const matched = labelsSatisfiedBy(['b', 'a'], ['a', 'b', 'c']);

    expect(matched).toBe(true);
  });
});

describe('rankTemplatesForLabels', () => {
  it('keeps only templates that satisfy the required labels', () => {
    const templates = [
      template({key: 'small', labels: ['ubuntu22', 'ubuntu22-2cpu']}),
      template({key: 'macos', labels: ['macos']}),
    ];

    const ranked = rankTemplatesForLabels(['ubuntu22'], templates);

    expect(ranked.map((entry) => entry.key)).toEqual(['small']);
  });

  it('orders cheapest first, then most specific, then by key', () => {
    const templates = [
      template({key: 'big', labels: ['ubuntu22', 'ubuntu22-4cpu'], cost: 4}),
      template({key: 'small', labels: ['ubuntu22', 'ubuntu22-2cpu'], cost: 2}),
      template({key: 'exact', labels: ['ubuntu22'], cost: 2}),
    ];

    const ranked = rankTemplatesForLabels(['ubuntu22'], templates);

    expect(ranked.map((entry) => entry.key)).toEqual(['exact', 'small', 'big']);
  });

  it('is deterministic regardless of input order', () => {
    const templates = [
      template({key: 'a', cost: 2}),
      template({key: 'b', cost: 1}),
      template({key: 'c', cost: 1}),
    ];

    const forward = rankTemplatesForLabels(['ubuntu22'], templates);
    const reversed = rankTemplatesForLabels(['ubuntu22'], [...templates].reverse());

    expect(forward.map((entry) => entry.key)).toEqual(['b', 'c', 'a']);
    expect(reversed.map((entry) => entry.key)).toEqual(['b', 'c', 'a']);
  });
});

describe('selectTemplate', () => {
  it('returns the most preferred matching template', () => {
    const templates = [template({key: 'big', cost: 4}), template({key: 'small', cost: 2})];

    const selected = selectTemplate(['ubuntu22'], templates);

    expect(selected?.key).toBe('small');
  });

  it('returns undefined when no template matches', () => {
    const templates = [template({key: 'linux', labels: ['ubuntu22']})];

    const selected = selectTemplate(['macos'], templates);

    expect(selected).toBeUndefined();
  });
});
