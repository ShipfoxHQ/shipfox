import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  type ContractReferenceResolver,
  checkCaseReferences,
  findContractReferences,
  parseContractReference,
  resolveContractReferences,
} from './contract-references.js';
import {parseContractCase, parseSandboxManifest} from './contract-schema.js';

const manifest = parseSandboxManifest({
  linear: {
    connection: 'linear_sandbox',
    fixtures: {issue: {identifier: 'CON-1', number: 7}},
    targets: {missing_issue: {kind: 'absent', identifier: 'CON-999999'}},
  },
});

function readCase(steps: unknown[], kind = 'read') {
  return parseContractCase({provider: 'linear', kind, modes: ['real'], steps});
}

const resolver: ContractReferenceResolver = {
  fixture: ({name, field}) => (name === 'issue' && field === 'number' ? 7 : 'CON-1'),
  target: () => 'CON-999999',
  steps: ({key, path}) => `steps.${key}.outputs.${path}`,
  marker: () => 'contract-run',
};

describe('parseContractReference', () => {
  it('reads the four reference forms', () => {
    expect(parseContractReference('$fixture.linear.issue.uuid')).toEqual({
      kind: 'fixture',
      provider: 'linear',
      name: 'issue',
      field: 'uuid',
    });
    expect(parseContractReference('$target.linear.missing_issue.identifier')?.kind).toBe('target');
    expect(parseContractReference('$steps.send.messages[0].ts')).toEqual({
      kind: 'steps',
      key: 'send',
      path: 'messages[0].ts',
    });
    expect(parseContractReference('$marker')).toEqual({kind: 'marker'});
  });

  it('returns undefined for an unknown form', () => {
    expect(parseContractReference('$fixtures.linear.issue.uuid')).toBeUndefined();
    expect(parseContractReference('$fixture.linear.issue')).toBeUndefined();
    expect(parseContractReference('$markers')).toBeUndefined();
    expect(parseContractReference('$steps.send')).toBeUndefined();
  });
});

describe('findContractReferences', () => {
  it('finds references in nested values with their paths', () => {
    const found = findContractReferences({
      id: '$fixture.linear.issue.identifier',
      body: ['Contract $marker', 3],
    });

    expect(found.map(({path, token}) => [path, token])).toEqual([
      ['id', '$fixture.linear.issue.identifier'],
      ['body[0]', '$marker'],
    ]);
  });
});

describe('resolveContractReferences', () => {
  it('keeps the type of a value that is only a reference', () => {
    const resolved = resolveContractReferences({number: '$fixture.linear.issue.number'}, resolver);

    expect(resolved).toEqual({number: 7});
  });

  it('writes a reference inside longer text as text', () => {
    const resolved = resolveContractReferences(['Contract $marker updated'], resolver);

    expect(resolved).toEqual(['Contract contract-run updated']);
  });

  it('hands a steps reference to the resolver', () => {
    const resolved = resolveContractReferences('$steps.send.ts', resolver);

    expect(resolved).toBe('steps.send.outputs.ts');
  });

  it('leaves object keys and plain text alone', () => {
    const resolved = resolveContractReferences({'messages[0].text': 'costs 5 dollars'}, resolver);

    expect(resolved).toEqual({'messages[0].text': 'costs 5 dollars'});
  });
});

describe('checkCaseReferences', () => {
  it('accepts references that resolve', () => {
    const contractCase = readCase([
      {
        key: 'first',
        tool: 'save_issue',
        with: {title: 'Contract $marker', id: '$fixture.linear.issue.identifier'},
        effect: {tool: 'get_issue', with: {id: '$steps.first.id'}},
      },
      {tool: 'get_issue', with: {id: '$steps.first.id'}},
    ]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([]);
  });

  it('rejects an unknown reference form', () => {
    const contractCase = readCase([{tool: 'get_issue', with: {id: '$fixtures.linear.issue.x'}}]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      'steps.0.with.id: unknown reference $fixtures.linear.issue.x',
    ]);
  });

  it('rejects a fixture the manifest lacks', () => {
    const contractCase = readCase([{tool: 'get_issue', with: {id: '$fixture.linear.issue.uuid'}}]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      'steps.0.with.id: $fixture.linear.issue.uuid is not in sandbox.yaml',
    ]);
  });

  it('rejects a target in a case that is not an error case', () => {
    const contractCase = readCase([
      {tool: 'get_issue', with: {id: '$target.linear.missing_issue.identifier'}},
    ]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      'steps.0.with.id: $target.linear.missing_issue.identifier is only for cases of kind `error`',
    ]);
  });

  it('accepts a target in an error case', () => {
    const contractCase = readCase(
      [
        {
          tool: 'get_issue',
          with: {id: '$target.linear.missing_issue.identifier'},
          expect: {error: 'not-found'},
        },
      ],
      'error',
    );

    expect(checkCaseReferences({contractCase, manifest})).toEqual([]);
  });

  it('rejects a steps reference to a later step', () => {
    const contractCase = readCase([
      {tool: 'get_issue', with: {id: '$steps.later.id'}},
      {key: 'later', tool: 'save_issue'},
    ]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      'steps.0.with.id: $steps.later.id reads a step that runs later',
    ]);
  });

  it('rejects a steps reference from a step to itself, but not from its effect', () => {
    const contractCase = readCase([
      {
        key: 'write',
        tool: 'save_issue',
        with: {id: '$steps.write.id'},
        effect: {tool: 'get_issue', with: {id: '$steps.write.id'}},
      },
    ]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      'steps.0.with.id: $steps.write.id reads a step that runs later',
    ]);
  });

  it('rejects a steps reference to a missing key', () => {
    const contractCase = readCase([{tool: 'get_issue', with: {id: '$steps.nope.id'}}]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      "steps.0.with.id: $steps.nope.id names a step key the case doesn't have",
    ]);
  });

  it('rejects $marker and $steps in expect and in an effect expect, which a gate cannot read', () => {
    const contractCase = readCase([
      {key: 'first', tool: 'save_issue'},
      {
        tool: 'get_issue',
        expect: {values: {title: 'Contract $marker'}},
        effect: {
          tool: 'get_issue',
          expect: {values: {id: '$steps.first.id'}, includes: {labels: {name: '$marker'}}},
        },
      },
    ]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      'steps.1.expect.values.title: $marker is only for `with`, not `expect`',
      'steps.1.effect.expect.values.id: $steps.first.id is only for `with`, not `expect`',
      'steps.1.effect.expect.includes.labels.name: $marker is only for `with`, not `expect`',
    ]);
  });

  it('checks references in expect values', () => {
    const contractCase = readCase([
      {tool: 'get_issue', expect: {values: {id: '$fixture.linear.nope.id'}}},
    ]);

    expect(checkCaseReferences({contractCase, manifest})).toEqual([
      'steps.0.expect.values.id: $fixture.linear.nope.id is not in sandbox.yaml',
    ]);
  });
});
