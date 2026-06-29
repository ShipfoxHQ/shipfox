import {extractCelContextRoots} from './extract-cel-context-roots.js';

describe('extractCelContextRoots', () => {
  it('extracts a single top-level root', () => {
    const contextRoots = extractCelContextRoots('event.ref');

    expect(contextRoots).toEqual(['event']);
  });

  it('skips member names after top-level context roots', () => {
    const contextRoots = extractCelContextRoots('event.pull_request.title');

    expect(contextRoots).toEqual(['event']);
  });

  it('extracts sorted unique context roots across operators, ternaries, and indexes', () => {
    const contextRoots = extractCelContextRoots(
      'inputs.count > 1 && (event.ok || run.name == trigger["name"]) ? job.id : event.id',
    );

    expect(contextRoots).toEqual(['event', 'inputs', 'job', 'run', 'trigger']);
  });

  it('skips member access after calls and indexes', () => {
    const contextRoots = extractCelContextRoots('foo().event == x[0].event');

    expect(contextRoots).toEqual(['x']);
  });

  it('skips function heads while scanning their arguments', () => {
    const contextRoots = extractCelContextRoots('has(event.ref) && size(inputs.files) > 0');

    expect(contextRoots).toEqual(['event', 'inputs']);
  });

  it('keeps receiver context roots for method calls', () => {
    const contextRoots = extractCelContextRoots('event.matches("main")');

    expect(contextRoots).toEqual(['event']);
  });

  it('excludes CEL reserved words', () => {
    const contextRoots = extractCelContextRoots(
      'event.ref in ["main"] && true != false && null == null',
    );

    expect(contextRoots).toEqual(['event']);
  });

  it('keeps macro receivers and does not subtract local names globally', () => {
    const contextRoots = extractCelContextRoots('items.exists(event, event.ok) || event.ref');

    expect(contextRoots).toEqual(['event', 'items']);
  });

  it('does not extract context roots from numeric literal suffixes or exponents', () => {
    const contextRoots = extractCelContextRoots(
      'event.n == 123u && 1.5e10 > inputs.x && 0xFFu > 0',
    );

    expect(contextRoots).toEqual(['event', 'inputs']);
  });

  it('ignores string contents across escaped, raw, and triple-quoted strings', () => {
    const contextRoots = extractCelContextRoots(
      '"inputs.x\\"" + r"event.y\\\\" + """run.z""" + b"trigger.name" + job.id',
    );

    expect(contextRoots).toEqual(['job']);
  });

  it('ignores comment contents', () => {
    const contextRoots = extractCelContextRoots('event.x // run.y "unterminated\n && inputs.ok');

    expect(contextRoots).toEqual(['event', 'inputs']);
  });

  it('handles underscore and digit identifier characters', () => {
    const contextRoots = extractCelContextRoots('_event1.ref == input_2.ref');

    expect(contextRoots).toEqual(['_event1', 'input_2']);
  });

  it('returns an empty list when no context roots are present', () => {
    const contextRoots = extractCelContextRoots('"event.x" == "event.x" && true');

    expect(contextRoots).toEqual([]);
  });

  it('intentionally over-includes comprehension bound names', () => {
    const contextRoots = extractCelContextRoots('list.exists(x, x.enabled)');

    expect(contextRoots).toEqual(['list', 'x']);
  });

  it('intentionally over-includes struct keys', () => {
    const contextRoots = extractCelContextRoots('{foo: event.x}');

    expect(contextRoots).toEqual(['event', 'foo']);
  });

  it('extracts every known v1 workflow context root', () => {
    const contextRoots = extractCelContextRoots(
      'run.id + trigger.name + event.ref + inputs.branch + job.attempt',
    );

    expect(contextRoots).toEqual(['event', 'inputs', 'job', 'run', 'trigger']);
  });
});
