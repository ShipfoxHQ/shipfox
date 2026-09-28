import {describe, expect, it} from '@shipfox/vitest/vi';
import {formatTemplateHeader, parseTemplateHeader} from './header.js';

describe('parseTemplateHeader', () => {
  it('parses a registry header without a manifest', () => {
    const header = parseTemplateHeader(
      '# shipfox-template: shipfox/ticket-to-pr@1.2.0; roles: source=github tracker=linear; options: feedback_loop=on pr_mode=draft',
    );

    expect(header).toEqual({
      ref: {namespace: 'shipfox', name: 'ticket-to-pr', version: '1.2.0'},
      bindings: {source: 'github', tracker: 'linear'},
      options: {feedback_loop: 'on', pr_mode: 'draft'},
    });
  });

  it.each([
    ['a reference alone', 'shipfox/ask-codebase@1.0.0', {}, {}],
    ['roles alone', 'shipfox/ask-codebase@1.0.0; roles: chat=slack', {chat: 'slack'}, {}],
    [
      'options alone',
      'shipfox/ask-codebase@1.0.0; options: entry_point=mention',
      {},
      {entry_point: 'mention'},
    ],
  ])('parses %s', (_name, body, bindings, options) => {
    expect(parseTemplateHeader(`# shipfox-template: ${body}`)).toEqual({
      ref: {namespace: 'shipfox', name: 'ask-codebase', version: '1.0.0'},
      bindings,
      options,
    });
  });

  it('keeps a role and an option of the same name apart', () => {
    const header = parseTemplateHeader(
      '# shipfox-template: shipfox/fixture@2.0.0; roles: source=github report=slack; options: source=on report=daily',
    );

    expect(header).toMatchObject({
      bindings: {source: 'github', report: 'slack'},
      options: {source: 'on', report: 'daily'},
    });
  });

  it('parses a legacy header', () => {
    expect(
      parseTemplateHeader('# shipfox-template: ticket-to-pr@3 source=github tracker=linear'),
    ).toEqual({
      legacy: {id: 'ticket-to-pr', revision: 3, bindings: {source: 'github', tracker: 'linear'}},
    });
  });

  it('parses a legacy header without roles', () => {
    expect(parseTemplateHeader('# shipfox-template: report-failed-runs@12')).toEqual({
      legacy: {id: 'report-failed-runs', revision: 12, bindings: {}},
    });
  });

  it('reads the header after leading comments in a workflow', () => {
    const workflow = [
      '# yaml-language-server: $schema=https://www.shipfox.io/docs/workflow.schema.json',
      '# shipfox-template: shipfox/ask-codebase@1.0.0; roles: chat=slack',
      '',
      'name: ask',
    ].join('\n');

    expect(parseTemplateHeader(workflow)).toMatchObject({bindings: {chat: 'slack'}});
  });

  it('ignores a header mentioned after the workflow starts', () => {
    const workflow = [
      'name: ask',
      'prompt: |',
      '  # shipfox-template: shipfox/ask-codebase@1.0.0',
    ].join('\n');

    expect(parseTemplateHeader(workflow)).toBeUndefined();
  });

  it('returns undefined without a header', () => {
    expect(parseTemplateHeader('# just a comment\nname: ask')).toBeUndefined();
    expect(parseTemplateHeader('')).toBeUndefined();
  });

  it.each([
    ['a range', '# shipfox-template: shipfox/ask-codebase@^1.0.0'],
    ['a moving tag', '# shipfox-template: shipfox/ask-codebase@latest'],
    ['a missing version', '# shipfox-template: shipfox/ask-codebase'],
    ['an uppercase package', '# shipfox-template: Shipfox/ask-codebase@1.0.0'],
    ['a pre-release version', '# shipfox-template: shipfox/ask-codebase@1.0.0-beta.1'],
    ['an unknown group', '# shipfox-template: shipfox/ask-codebase@1.0.0; extras: a=b'],
    ['an empty group', '# shipfox-template: shipfox/ask-codebase@1.0.0; roles:'],
    [
      'groups out of order',
      '# shipfox-template: shipfox/ask-codebase@1.0.0; options: a=b; roles: chat=slack',
    ],
    [
      'a repeated group',
      '# shipfox-template: shipfox/ask-codebase@1.0.0; roles: chat=slack; roles: chat=slack',
    ],
    ['a pair without a value', '# shipfox-template: shipfox/ask-codebase@1.0.0; roles: chat'],
    [
      'a repeated key',
      '# shipfox-template: shipfox/ask-codebase@1.0.0; roles: chat=slack chat=discord',
    ],
    ['a legacy header with a group', '# shipfox-template: ask-codebase@1; roles: chat=slack'],
    ['a legacy header with a non-integer revision', '# shipfox-template: ask-codebase@1.0'],
    ['a legacy header without a revision', '# shipfox-template: ask-codebase chat=slack'],
    ['an empty header', '# shipfox-template:'],
  ])('rejects %s', (_name, header) => {
    expect(parseTemplateHeader(header)).toBeUndefined();
  });
});

describe('formatTemplateHeader', () => {
  const ref = {namespace: 'shipfox', name: 'ticket-to-pr', version: '1.2.0'};

  it('writes roles and then options, omitting an empty group', () => {
    expect(
      formatTemplateHeader({
        ref,
        bindings: {source: 'github', tracker: 'linear'},
        options: {feedback_loop: 'on'},
      }),
    ).toBe(
      '# shipfox-template: shipfox/ticket-to-pr@1.2.0; roles: source=github tracker=linear; options: feedback_loop=on',
    );
    expect(formatTemplateHeader({ref, bindings: {}, options: {feedback_loop: 'on'}})).toBe(
      '# shipfox-template: shipfox/ticket-to-pr@1.2.0; options: feedback_loop=on',
    );
    expect(formatTemplateHeader({ref, bindings: {}, options: {}})).toBe(
      '# shipfox-template: shipfox/ticket-to-pr@1.2.0',
    );
  });

  it('writes a legacy header', () => {
    expect(
      formatTemplateHeader({
        legacy: {id: 'ticket-to-pr', revision: 3, bindings: {source: 'github'}},
      }),
    ).toBe('# shipfox-template: ticket-to-pr@3 source=github');
  });

  it.each([
    {ref, bindings: {source: 'github'}, options: {source: 'on'}},
    {ref, bindings: {}, options: {}},
    {legacy: {id: 'ticket-to-pr', revision: 3, bindings: {source: 'github'}}},
    {legacy: {id: 'ticket-to-pr', revision: 3, bindings: {}}},
  ])('round-trips through parseTemplateHeader', (header) => {
    expect(parseTemplateHeader(formatTemplateHeader(header))).toEqual(header);
  });

  it('refuses an identity, reference, and pairs the parser would reject', () => {
    expect(() =>
      formatTemplateHeader({legacy: {id: 'Ticket To PR', revision: 3, bindings: {}}}),
    ).toThrow('Invalid legacy template identity: Ticket To PR@3');
    expect(() =>
      formatTemplateHeader({legacy: {id: 'ticket-to-pr', revision: 1.5, bindings: {}}}),
    ).toThrow('Invalid legacy template identity: ticket-to-pr@1.5');
    expect(() =>
      formatTemplateHeader({legacy: {id: 'ticket-to-pr', revision: -1, bindings: {}}}),
    ).toThrow('Invalid legacy template identity: ticket-to-pr@-1');
    expect(() =>
      formatTemplateHeader({ref: {...ref, version: '1.x'}, bindings: {}, options: {}}),
    ).toThrow('Invalid registry reference for the template header');
    expect(() => formatTemplateHeader({ref, bindings: {source: 'git hub'}, options: {}})).toThrow(
      'Invalid template header pair: source=git hub',
    );
  });
});
