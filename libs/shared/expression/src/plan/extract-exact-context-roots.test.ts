import {extractExactContextRoots} from './extract-exact-context-roots.js';

describe('extractExactContextRoots', () => {
  it('extracts sorted unique free context roots', () => {
    const roots = extractExactContextRoots(
      'inputs.count > 1 && (event.ok || run.name == trigger["name"]) ? job.id : event.id',
    );

    expect(roots).toEqual(['event', 'inputs', 'job', 'run', 'trigger']);
  });

  it.each([
    ['executions.all(e, e.status == "succeeded")', ['executions']],
    ['executions.all(step, step.status == "x")', ['executions']],
    ['executions.all(runner, runner.status)', ['executions']],
    ['executions.map(e, e.status)', ['executions']],
    ['executions.filter(e, e.status == "x")', ['executions']],
    ['executions.exists(e, e.events.exists(event, event.data.ok))', ['executions']],
  ])('excludes comprehension aliases in %s', (source, expectedRoots) => {
    const roots = extractExactContextRoots(source);

    expect(roots).toEqual(expectedRoots);
  });

  it('does not leak map-literal keys as roots', () => {
    const roots = extractExactContextRoots('{runner: event.x, step: inputs.value}');

    expect(roots).toEqual(['event', 'inputs']);
  });

  it('extracts roots from dynamic map keys', () => {
    const roots = extractExactContextRoots('{run.id: event.x, trigger.event + inputs.suffix: "x"}');

    expect(roots).toEqual(['event', 'inputs', 'run', 'trigger']);
  });

  it('keeps receiver-call arguments when the method is not a comprehension macro', () => {
    const roots = extractExactContextRoots('event.ref.matches(inputs.pattern)');

    expect(roots).toEqual(['event', 'inputs']);
  });

  it('keeps unknown free identifiers so callers can decide how to route them', () => {
    const roots = extractExactContextRoots('typo_root.value + run.id');

    expect(roots).toEqual(['run', 'typo_root']);
  });

  it('throws when the CEL source cannot be parsed', () => {
    const act = () => extractExactContextRoots('event.');

    expect(act).toThrow();
  });
});
