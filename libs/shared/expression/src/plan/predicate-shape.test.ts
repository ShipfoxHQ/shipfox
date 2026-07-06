import {predicateSourceIsBooleanShaped} from './predicate-shape.js';

describe('predicateSourceIsBooleanShaped', () => {
  it.each([
    'event.ref == "refs/heads/main"',
    'event.ref != "refs/heads/main"',
    'event.count > 0',
    '"admin" in event.labels',
    'event.ref == "main" && trigger.event == "push"',
    'event.ref == "main" || trigger.event == "push"',
    '!event.deleted',
    'true',
    'false',
    'event.labels.exists(label, label == "bug")',
    'event.labels.all(label, label != "")',
    'event.labels.exists_one(label, label == "bug")',
    'has(event.ref)',
    'has(jobs.build.outputs.pr_number)',
    'event.ref.matches("^refs/heads/")',
    'event.ref.startsWith("refs/")',
    'event.ref.endsWith("/main")',
    'event.ref.contains("main")',
    'contains(event.ref, "main")',
    'event.ready ? true : event.ref == "main"',
  ])('accepts boolean-shaped predicates: %s', (source) => {
    const result = predicateSourceIsBooleanShaped(source);

    expect(result).toBe(true);
  });

  it.each([
    'event.ref',
    'trigger.event',
    '"main"',
    '1',
    'null',
    'event.count + 1',
    '{ref: event.ref}',
    '[event.ref]',
    'event.labels.map(label, label)',
    'event.ready ? 1 : 2',
    'event.ready ? event.ref == "main" : event.ref',
    'event.',
  ])('rejects non-boolean-shaped predicates: %s', (source) => {
    const result = predicateSourceIsBooleanShaped(source);

    expect(result).toBe(false);
  });
});
