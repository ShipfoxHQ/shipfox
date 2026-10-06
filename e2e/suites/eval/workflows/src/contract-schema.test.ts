import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  parseContractBacklog,
  parseContractCase,
  parseContractExemption,
  parseSandboxManifest,
} from './contract-schema.js';

const repeatedKeyPattern = /used twice/iu;
const onlyErrorPattern = /only a case of kind `error`/iu;
const needsErrorPattern = /needs a step with `expect.error`/iu;
const noOutputPattern = /no output to check/iu;
const shapePattern = /shape/iu;
const methodPattern = /method needs its tool/iu;
const targetKindPattern = /kind/iu;
const issuePattern = /Linear issue/iu;
const emptyPattern = /must not be empty/iu;
const listedTwicePattern = /listed twice/iu;

const getIssue = {
  provider: 'linear',
  modes: ['real', 'fake'],
  steps: [
    {
      tool: 'get_issue',
      with: {id: '$fixture.linear.issue.identifier'},
      expect: {
        shape: {id: 'string', labels: [{name: 'string'}], team: {id: 'string', key: 'string'}},
        values: {id: '$fixture.linear.issue.identifier'},
      },
    },
  ],
};

describe('contract case schema', () => {
  it('loads a read case and defaults its kind', () => {
    const parsed = parseContractCase(getIssue);

    expect(parsed.kind).toBe('read');
    expect(parsed.steps[0]?.expect.shape).toEqual(getIssue.steps[0]?.expect.shape);
  });

  it('loads a round-trip case with an effect', () => {
    const parsed = parseContractCase({
      provider: 'slack',
      kind: 'round-trip',
      modes: ['real'],
      steps: [
        {
          key: 'send',
          tool: 'send_message',
          with: {message: 'Contract $marker'},
          expect: {shape: {ts: 'string'}},
          effect: {
            tool: 'read_thread',
            with: {message_ts: '$steps.send.ts', limit: 1},
            expect: {includes: {'messages[0].reactions': {name: 'white_check_mark'}}},
          },
        },
      ],
    });

    expect(parsed.steps[0]?.effect?.tool).toBe('read_thread');
  });

  it('loads an error case', () => {
    const parsed = parseContractCase({
      provider: 'linear',
      kind: 'error',
      modes: ['real', 'fake'],
      steps: [{tool: 'get_issue', expect: {error: 'not-found'}}],
    });

    expect(parsed.steps[0]?.expect.error).toBe('not-found');
  });

  it('accepts a method on a family tool', () => {
    const parsed = parseContractCase({
      provider: 'github',
      modes: ['real'],
      steps: [{tool: 'issue_read', method: 'get', with: {issue_number: 1}}],
    });

    expect(parsed.steps[0]?.method).toBe('get');
  });

  it('rejects a case without a mode', () => {
    expect(() => parseContractCase({...getIssue, modes: []})).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() => parseContractCase({...getIssue, extra: true})).toThrow();
  });

  it('rejects a shape type outside the subset', () => {
    const steps = [{tool: 'get_issue', expect: {shape: {id: 'uuid'}}}];

    expect(() => parseContractCase({...getIssue, steps})).toThrow(shapePattern);
  });

  it('rejects a list shape with more than one item', () => {
    const steps = [
      {tool: 'get_issue', expect: {shape: {labels: [{name: 'string'}, {id: 'string'}]}}},
    ];

    expect(() => parseContractCase({...getIssue, steps})).toThrow();
  });

  it('rejects a repeated step key', () => {
    const steps = [
      {key: 'one', tool: 'get_issue'},
      {key: 'one', tool: 'get_issue'},
    ];

    expect(() => parseContractCase({...getIssue, steps})).toThrow(repeatedKeyPattern);
  });

  it('rejects an expected error outside an error case', () => {
    const steps = [{tool: 'get_issue', expect: {error: 'not-found'}}];

    expect(() => parseContractCase({...getIssue, steps})).toThrow(onlyErrorPattern);
  });

  it('rejects an error case that expects no error', () => {
    expect(() => parseContractCase({...getIssue, kind: 'error'})).toThrow(needsErrorPattern);
  });

  it('rejects an expected error beside output checks', () => {
    const steps = [{tool: 'get_issue', expect: {error: 'not-found', values: {id: 'a'}}}];

    expect(() => parseContractCase({...getIssue, kind: 'error', steps})).toThrow(noOutputPattern);
  });

  it('rejects an expected error beside a matches check', () => {
    const steps = [{tool: 'get_issue', expect: {error: 'not-found', matches: {id: 'a'}}}];

    expect(() => parseContractCase({...getIssue, kind: 'error', steps})).toThrow(noOutputPattern);
  });

  it('rejects empty values and includes assertions', () => {
    for (const expectation of [{values: {}}, {includes: {}}, {includes: {'messages[0]': {}}}]) {
      const steps = [{tool: 'get_issue', expect: expectation}];

      expect(() => parseContractCase({...getIssue, steps})).toThrow(emptyPattern);
    }
  });

  it('rejects an error in an effect', () => {
    const steps = [{tool: 'save_issue', effect: {tool: 'get_issue', expect: {error: 'not-found'}}}];

    expect(() => parseContractCase({...getIssue, kind: 'round-trip', steps})).toThrow();
  });
});

describe('contract exemption schema', () => {
  it('loads a tool exemption', () => {
    const parsed = parseContractExemption({
      provider: 'github',
      exempt: {tool: 'actions_run_trigger', method: 'dispatch', reason: 'Costs a runner.'},
    });

    expect(parsed.exempt.tool).toBe('actions_run_trigger');
  });

  it('loads a whole-provider exemption', () => {
    const parsed = parseContractExemption({
      provider: 'gitea',
      exempt: {reason: 'Staging has no Gitea instance.'},
    });

    expect(parsed.exempt.tool).toBeUndefined();
  });

  it('rejects an exemption without a reason', () => {
    expect(() => parseContractExemption({provider: 'gitea', exempt: {}})).toThrow();
  });

  it('rejects a method without its tool', () => {
    expect(() =>
      parseContractExemption({provider: 'github', exempt: {method: 'get', reason: 'No.'}}),
    ).toThrow(methodPattern);
  });
});

describe('sandbox manifest schema', () => {
  const manifest = {
    linear: {
      connection: 'linear_sandbox',
      fixtures: {issue: {identifier: 'CON-1', uuid: '8e3b', number: 7}},
      targets: {missing_issue: {kind: 'absent', identifier: 'CON-999999'}},
    },
    slack: {
      connection: 'slack_sandbox',
      fixtures: {write_channel: {id: 'C01', name: 'contracts-write'}},
      targets: {private_channel: {kind: 'inaccessible', id: 'C02'}},
    },
  };

  it('loads fixtures and targets per provider', () => {
    const parsed = parseSandboxManifest(manifest);

    expect(parsed.linear?.targets.missing_issue).toEqual({
      kind: 'absent',
      identifier: 'CON-999999',
    });
    expect(parsed.slack?.fixtures.write_channel?.id).toBe('C01');
  });

  it('defaults fixtures and targets', () => {
    const parsed = parseSandboxManifest({sentry: {connection: 'sentry_sandbox'}});

    expect(parsed.sentry).toEqual({connection: 'sentry_sandbox', fixtures: {}, targets: {}});
  });

  it('rejects a target kind outside absent and inaccessible', () => {
    const invalid = {
      linear: {connection: 'linear_sandbox', targets: {gone: {kind: 'deleted', id: 'a'}}},
    };

    expect(() => parseSandboxManifest(invalid)).toThrow(targetKindPattern);
  });

  it('rejects a provider without a connection', () => {
    expect(() => parseSandboxManifest({linear: {fixtures: {}}})).toThrow();
  });

  it('loads the read of a fixture beside its fields', () => {
    const read = {tool: 'get_issue', with: {id: '$fixture.linear.issue.identifier'}};
    const parsed = parseSandboxManifest({
      linear: {connection: 'linear_sandbox', fixtures: {issue: {identifier: 'CON-1', read}}},
    });

    expect(parsed.linear?.fixtures.issue?.identifier).toBe('CON-1');
    expect(parsed.linear?.fixtures.issue?.read).toEqual({...read, expect: {}});
  });

  it('rejects a fixture read with an unknown key', () => {
    const invalid = {
      linear: {
        connection: 'linear_sandbox',
        fixtures: {issue: {read: {tool: 'get_issue', effect: {}}}},
      },
    };

    expect(() => parseSandboxManifest(invalid)).toThrow();
  });
});

describe('contract backlog schema', () => {
  it('loads a ceiling and its entries', () => {
    const parsed = parseContractBacklog({
      ceiling: 2,
      entries: [
        {tool: 'linear.save_issue', kind: 'write', issue: 'ENG-2816'},
        {tool: 'github.pull_request_read', method: 'get_files', kind: 'read', issue: 'ENG-2811'},
      ],
    });

    expect(parsed.entries).toHaveLength(2);
  });

  it('rejects an entry without a Linear issue', () => {
    const entries = [{tool: 'linear.save_issue', kind: 'write', issue: 'soon'}];

    expect(() => parseContractBacklog({ceiling: 1, entries})).toThrow(issuePattern);
  });

  it('rejects an entry listed twice', () => {
    const entry = {tool: 'linear.save_issue', kind: 'write', issue: 'ENG-1'};

    expect(() => parseContractBacklog({ceiling: 2, entries: [entry, entry]})).toThrow(
      listedTwicePattern,
    );
  });

  it('rejects a tool without its provider', () => {
    const entries = [{tool: 'save_issue', kind: 'write', issue: 'ENG-1'}];

    expect(() => parseContractBacklog({ceiling: 1, entries})).toThrow();
  });
});
