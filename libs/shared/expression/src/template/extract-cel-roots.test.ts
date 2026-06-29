import {extractCelRoots} from './extract-cel-roots.js';

describe('extractCelRoots', () => {
  it('extracts a single top-level root', () => {
    const roots = extractCelRoots('event.ref');

    expect(roots).toEqual(['event']);
  });

  it('skips member names after top-level roots', () => {
    const roots = extractCelRoots('event.pull_request.title');

    expect(roots).toEqual(['event']);
  });

  it('extracts sorted unique roots across operators, ternaries, and indexes', () => {
    const roots = extractCelRoots(
      'inputs.count > 1 && (event.ok || run.name == trigger["name"]) ? job.id : event.id',
    );

    expect(roots).toEqual(['event', 'inputs', 'job', 'run', 'trigger']);
  });

  it('skips member access after calls and indexes', () => {
    const roots = extractCelRoots('foo().event == x[0].event');

    expect(roots).toEqual(['x']);
  });

  it('skips function heads while scanning their arguments', () => {
    const roots = extractCelRoots('has(event.ref) && size(inputs.files) > 0');

    expect(roots).toEqual(['event', 'inputs']);
  });

  it('keeps receiver roots for method calls', () => {
    const roots = extractCelRoots('event.matches("main")');

    expect(roots).toEqual(['event']);
  });

  it('excludes CEL reserved words', () => {
    const roots = extractCelRoots('event.ref in ["main"] && true != false && null == null');

    expect(roots).toEqual(['event']);
  });

  it('keeps macro receivers and does not subtract local names globally', () => {
    const roots = extractCelRoots('items.exists(event, event.ok) || event.ref');

    expect(roots).toEqual(['event', 'items']);
  });

  it('does not extract roots from numeric literal suffixes or exponents', () => {
    const roots = extractCelRoots('event.n == 123u && 1.5e10 > inputs.x && 0xFFu > 0');

    expect(roots).toEqual(['event', 'inputs']);
  });

  it('ignores string contents across escaped, raw, and triple-quoted strings', () => {
    const roots = extractCelRoots(
      '"inputs.x\\"" + r"event.y\\\\" + """run.z""" + b"trigger.name" + job.id',
    );

    expect(roots).toEqual(['job']);
  });

  it('ignores comment contents', () => {
    const roots = extractCelRoots('event.x // run.y "unterminated\n && inputs.ok');

    expect(roots).toEqual(['event', 'inputs']);
  });

  it('handles underscore and digit identifier characters', () => {
    const roots = extractCelRoots('_event1.ref == input_2.ref');

    expect(roots).toEqual(['_event1', 'input_2']);
  });

  it('returns an empty list when no roots are present', () => {
    const roots = extractCelRoots('"event.x" == "event.x" && true');

    expect(roots).toEqual([]);
  });

  it('intentionally over-includes comprehension bound names', () => {
    const roots = extractCelRoots('list.exists(x, x.enabled)');

    expect(roots).toEqual(['list', 'x']);
  });

  it('intentionally over-includes struct keys', () => {
    const roots = extractCelRoots('{foo: event.x}');

    expect(roots).toEqual(['event', 'foo']);
  });

  it('extracts every known v1 workflow context root', () => {
    const roots = extractCelRoots(
      'run.id + trigger.name + event.ref + inputs.branch + job.attempt',
    );

    expect(roots).toEqual(['event', 'inputs', 'job', 'run', 'trigger']);
  });
});
