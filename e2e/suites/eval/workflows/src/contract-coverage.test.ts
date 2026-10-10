import {toolGrants} from '@shipfox/actions/tool-grants';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {
  type CatalogGrants,
  catalogUnits,
  checkContractCoverage,
  formatContractCoverageReport,
  uncoveredUnits,
} from './contract-coverage.js';
import {
  parseContractBacklog,
  parseContractCase,
  parseContractExemption,
} from './contract-schema.js';
import {type ContractFiles, loadContracts} from './contracts.js';

const grants: CatalogGrants = {
  linear: {
    get_issue: {sensitivity: 'read', result: 'json'},
    save_issue: {sensitivity: 'write', result: 'json'},
  },
  github: {
    issue_read: {
      sensitivity: 'read',
      result: 'json',
      methods: {get: 'read', get_comments: 'read'},
    },
  },
  gitea: {get_issue: {sensitivity: 'read', result: 'json'}},
};

interface FilesInput {
  cases?: Array<{
    id: string;
    provider: string;
    kind?: string;
    modes?: string[];
    steps: unknown[];
  }>;
  exemptions?: Array<{id: string; provider: string; tool?: string; method?: string}>;
  backlog?: Array<Record<string, string>>;
  ceiling?: number;
}

function arrange({cases = [], exemptions = [], backlog = [], ceiling}: FilesInput): ContractFiles {
  return {
    manifest: {},
    backlog: parseContractBacklog({ceiling: ceiling ?? backlog.length, entries: backlog}),
    cases: cases.map(({id, provider, kind, modes = ['real', 'fake'], steps}) => ({
      id,
      path: `${id}.yaml`,
      definition: parseContractCase({provider, kind, modes, steps}),
    })),
    exemptions: exemptions.map(({id, provider, tool, method}) => ({
      id,
      path: `${id}.yaml`,
      definition: parseContractExemption({
        provider,
        exempt: {...(tool && {tool}), ...(method && {method}), reason: 'Because.'},
      }),
    })),
  };
}

const everythingElse: FilesInput = {
  exemptions: [{id: 'gitea/all', provider: 'gitea'}],
  backlog: [
    {tool: 'linear.save_issue', kind: 'write', issue: 'ENG-1'},
    {tool: 'github.issue_read', method: 'get_comments', kind: 'read', issue: 'ENG-1'},
  ],
};

describe('catalogUnits', () => {
  it('expands a method family into one unit per method', () => {
    expect(catalogUnits(grants).map(({key, kind}) => `${key} ${kind}`)).toEqual([
      'linear.get_issue read',
      'linear.save_issue write',
      'github.issue_read#get read',
      'github.issue_read#get_comments read',
      'gitea.get_issue read',
    ]);
  });
});

describe('checkContractCoverage', () => {
  const getIssue = {id: 'linear/get-issue', provider: 'linear', steps: [{tool: 'get_issue'}]};
  const issueReadGet = {
    id: 'github/issue-read-get',
    provider: 'github',
    steps: [{tool: 'issue_read', method: 'get'}],
  };

  // The effect of a write: it reads the issue the write created and checks a value.
  const savedIssue = {
    tool: 'get_issue',
    with: {id: '$steps.save.id'},
    expect: {values: {title: 'Contract'}},
  };

  it('passes when every unit has a case, an exemption, or a backlog entry', () => {
    const files = arrange({...everythingElse, cases: [getIssue, issueReadGet]});

    expect(checkContractCoverage({grants, files}).problems).toEqual([]);
  });

  it('fails a read tool with no case, exemption, or backlog entry', () => {
    const files = arrange({...everythingElse, cases: [issueReadGet]});

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'read linear.get_issue has no case, exemption, or backlog entry',
    ]);
  });

  it('fails a write tool with no case, exemption, or backlog entry', () => {
    const files = arrange({
      cases: [getIssue, issueReadGet],
      exemptions: [{id: 'gitea/all', provider: 'gitea'}],
      backlog: [{tool: 'github.issue_read', method: 'get_comments', kind: 'read', issue: 'ENG-1'}],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'write linear.save_issue has no case, exemption, or backlog entry',
    ]);
  });

  it('fails a method of a family tool that nothing covers', () => {
    const files = arrange({
      cases: [getIssue, issueReadGet],
      exemptions: [{id: 'gitea/all', provider: 'gitea'}],
      backlog: [{tool: 'linear.save_issue', kind: 'write', issue: 'ENG-1'}],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'read github.issue_read#get_comments has no case, exemption, or backlog entry',
    ]);
  });

  it('fails a backlog entry that now has its case', () => {
    const files = arrange({
      ...everythingElse,
      cases: [getIssue, issueReadGet],
      backlog: [
        ...(everythingElse.backlog ?? []),
        {tool: 'linear.get_issue', kind: 'read', issue: 'ENG-1'},
      ],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'backlog entry linear.get_issue now has a case, so remove the entry',
    ]);
  });

  it('fails a backlog entry for an exempt unit', () => {
    const files = arrange({
      ...everythingElse,
      cases: [getIssue, issueReadGet],
      backlog: [
        ...(everythingElse.backlog ?? []),
        {tool: 'gitea.get_issue', kind: 'read', issue: 'ENG-1'},
      ],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'backlog entry gitea.get_issue is exempt, so remove the entry',
    ]);
  });

  it('fails a tool that has an exemption and a case', () => {
    const files = arrange({
      ...everythingElse,
      cases: [
        getIssue,
        issueReadGet,
        {id: 'gitea/get-issue', provider: 'gitea', steps: [{tool: 'get_issue'}]},
      ],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'gitea.get_issue has an exemption (gitea/all) and a case (gitea/get-issue)',
    ]);
  });

  it('fails a case that names a tool or method the catalog does not have', () => {
    const files = arrange({
      ...everythingElse,
      cases: [
        getIssue,
        issueReadGet,
        {id: 'linear/gone', provider: 'linear', steps: [{tool: 'gone'}]},
        {id: 'github/no-method', provider: 'github', steps: [{tool: 'issue_read'}]},
        {
          id: 'github/bad-method',
          provider: 'github',
          steps: [{tool: 'issue_read', method: 'nope'}],
        },
        {id: 'linear/method', provider: 'linear', steps: [{tool: 'get_issue', method: 'get'}]},
        {id: 'jira/get', provider: 'jira', steps: [{tool: 'get_issue'}]},
      ],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'case linear/gone: step "gone" names "linear.gone" is not in the catalog',
      'case github/no-method: step "issue_read" names "github.issue_read" needs one of its methods',
      'case github/bad-method: step "issue_read" names "github.issue_read" has no method "nope"',
      'case linear/method: step "get_issue" names "linear.get_issue" has no methods',
      'case jira/get: step "get_issue" names provider "jira" is not in the catalog',
    ]);
  });

  it('fails an effect that names a tool the catalog does not have', () => {
    const files = arrange({
      ...everythingElse,
      cases: [
        getIssue,
        issueReadGet,
        {
          id: 'linear/save',
          provider: 'linear',
          kind: 'round-trip',
          steps: [{key: 'save', tool: 'save_issue', effect: {...savedIssue, tool: 'read_issue'}}],
        },
      ],
      backlog: [{tool: 'github.issue_read', method: 'get_comments', kind: 'read', issue: 'ENG-1'}],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'case linear/save: effect "read_issue" names "linear.read_issue" is not in the catalog',
      'write linear.save_issue has no case, exemption, or backlog entry',
    ]);
  });

  describe('effect rules', () => {
    const arrangeWrite = ({
      effect,
      kind = 'round-trip',
      backlogged = false,
    }: {
      effect?: unknown;
      kind?: string;
      backlogged?: boolean;
    }) =>
      arrange({
        cases: [
          getIssue,
          issueReadGet,
          {
            id: 'linear/save',
            provider: 'linear',
            kind,
            steps: [{key: 'save', tool: 'save_issue', ...(effect === undefined ? {} : {effect})}],
          },
        ],
        exemptions: [{id: 'gitea/all', provider: 'gitea'}],
        backlog: [
          {tool: 'github.issue_read', method: 'get_comments', kind: 'read', issue: 'ENG-1'},
          ...(backlogged ? [{tool: 'linear.save_issue', kind: 'write', issue: 'ENG-1'}] : []),
        ],
      });

    const problemsOf = (files: ContractFiles) => checkContractCoverage({grants, files}).problems;

    it('accepts a write whose effect reads an object the run created', () => {
      expect(problemsOf(arrangeWrite({effect: savedIssue}))).toEqual([]);
    });

    it('accepts a write whose effect filters its read with the marker', () => {
      const effect = {
        tool: 'get_issue',
        with: {id: 'Contract $marker'},
        expect: {includes: {labels: {name: 'bug'}}},
      };

      expect(problemsOf(arrangeWrite({effect}))).toEqual([]);
    });

    it('accepts a write whose effect asserts a pattern', () => {
      const effect = {...savedIssue, expect: {matches: {title: '^Contract'}}};

      expect(problemsOf(arrangeWrite({effect}))).toEqual([]);
    });

    it('fails a write without an effect', () => {
      expect(problemsOf(arrangeWrite({}))).toEqual([
        'case linear/save: write step "save_issue" has no `effect`',
        'write linear.save_issue has no case, exemption, or backlog entry',
      ]);
    });

    it('keeps the backlog entry of a write whose effect is not valid', () => {
      expect(problemsOf(arrangeWrite({backlogged: true}))).toEqual([
        'case linear/save: write step "save_issue" has no `effect`',
      ]);
    });

    it('fails an effect with only a shape check', () => {
      const effect = {...savedIssue, expect: {shape: {id: 'string'}}};

      expect(problemsOf(arrangeWrite({effect, backlogged: true}))).toEqual([
        'case linear/save: the effect of write step "save_issue" needs `expect.values`, `expect.includes`, or `expect.matches`, a shape check proves nothing',
      ]);
    });

    it('fails an effect with no assertion at all', () => {
      const effect = {tool: 'get_issue', with: {id: '$steps.save.id'}};

      expect(problemsOf(arrangeWrite({effect, backlogged: true}))).toEqual([
        'case linear/save: the effect of write step "save_issue" needs `expect.values`, `expect.includes`, or `expect.matches`, a shape check proves nothing',
      ]);
    });

    it('fails an effect on static data', () => {
      const effect = {...savedIssue, with: {id: 'CON-1'}};

      expect(problemsOf(arrangeWrite({effect, backlogged: true}))).toEqual([
        'case linear/save: the effect of write step "save_issue" reads static data: read an object this run created through `$steps`, or filter the read with `$marker`',
      ]);
    });

    it('fails an effect that writes', () => {
      const effect = {...savedIssue, tool: 'save_issue'};

      expect(problemsOf(arrangeWrite({effect, backlogged: true}))).toEqual([
        'case linear/save: the effect of write step "save_issue" must read, not write',
      ]);
    });

    it('fails a write step outside a round-trip case', () => {
      expect(
        problemsOf(arrangeWrite({effect: savedIssue, kind: 'read', backlogged: true})),
      ).toEqual(['case linear/save: write step "save_issue" needs a case of kind `round-trip`']);
    });
  });

  it('keeps the backlog entry of a write whose effect names an unknown tool', () => {
    const files = arrange({
      cases: [
        getIssue,
        issueReadGet,
        {
          id: 'linear/save',
          provider: 'linear',
          kind: 'round-trip',
          steps: [{key: 'save', tool: 'save_issue', effect: {...savedIssue, tool: 'read_issue'}}],
        },
      ],
      exemptions: [{id: 'gitea/all', provider: 'gitea'}],
      backlog: [
        {tool: 'github.issue_read', method: 'get_comments', kind: 'read', issue: 'ENG-1'},
        {tool: 'linear.save_issue', kind: 'write', issue: 'ENG-1'},
      ],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'case linear/save: effect "read_issue" names "linear.read_issue" is not in the catalog',
    ]);
  });

  it('does not count an effect read as the read tool case', () => {
    const files = arrange({
      cases: [
        issueReadGet,
        {
          id: 'linear/save',
          provider: 'linear',
          kind: 'round-trip',
          steps: [{key: 'save', tool: 'save_issue', effect: savedIssue}],
        },
      ],
      exemptions: [{id: 'gitea/all', provider: 'gitea'}],
      backlog: [{tool: 'github.issue_read', method: 'get_comments', kind: 'read', issue: 'ENG-1'}],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'read linear.get_issue has no case, exemption, or backlog entry',
    ]);
  });

  it('fails an exemption or backlog entry that names a tool or method the catalog does not have', () => {
    const files = arrange({
      cases: [getIssue, issueReadGet],
      exemptions: [
        {id: 'gitea/all', provider: 'gitea'},
        {id: 'linear/gone', provider: 'linear', tool: 'gone'},
        {id: 'github/nope', provider: 'github', tool: 'issue_read', method: 'nope'},
        {id: 'jira/all', provider: 'jira'},
      ],
      backlog: [
        ...(everythingElse.backlog ?? []),
        {tool: 'linear.gone', kind: 'read', issue: 'ENG-1'},
        {tool: 'github.issue_read', kind: 'read', issue: 'ENG-1'},
      ],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'exemption linear/gone: names "linear.gone" is not in the catalog',
      'exemption github/nope: names "github.issue_read" has no method "nope"',
      'exemption jira/all: names provider "jira" is not in the catalog',
      'backlog entry linear.gone names "linear.gone" is not in the catalog',
      'backlog entry github.issue_read names "github.issue_read" needs one of its methods',
    ]);
  });

  it('fails a backlog entry whose kind is not the catalog sensitivity', () => {
    const files = arrange({
      ...everythingElse,
      cases: [getIssue, issueReadGet],
      backlog: [
        {tool: 'linear.save_issue', kind: 'read', issue: 'ENG-1'},
        {tool: 'github.issue_read', method: 'get_comments', kind: 'read', issue: 'ENG-1'},
      ],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'backlog entry linear.save_issue is a read, but the catalog says write',
    ]);
  });

  it('fails a backlog over its ceiling', () => {
    const files = arrange({...everythingElse, cases: [getIssue, issueReadGet], ceiling: 1});

    expect(checkContractCoverage({grants, files}).problems).toEqual([
      'the backlog has 2 entries, over its ceiling of 1',
    ]);
  });

  it('exempts the methods of a family tool that an exemption names without a method', () => {
    const files = arrange({
      cases: [getIssue],
      exemptions: [
        {id: 'gitea/all', provider: 'gitea'},
        {id: 'github/issue-read', provider: 'github', tool: 'issue_read'},
      ],
      backlog: [{tool: 'linear.save_issue', kind: 'write', issue: 'ENG-1'}],
    });

    expect(checkContractCoverage({grants, files}).problems).toEqual([]);
  });

  it('reports pending cases and the backlog size without failing', () => {
    const files = arrange({
      ...everythingElse,
      cases: [{...getIssue, modes: ['real']}, issueReadGet],
    });

    const coverage = checkContractCoverage({grants, files});

    expect(coverage.problems).toEqual([]);
    expect(coverage.pending).toEqual(['linear/get-issue']);
    expect(coverage.backlog).toEqual([
      {provider: 'github', kind: 'read', count: 1},
      {provider: 'linear', kind: 'write', count: 1},
    ]);
    expect(formatContractCoverageReport(coverage)).toContain('Pending cases (no fake mode): 1');
  });
});

describe('uncoveredUnits', () => {
  it('lists the units with neither a case nor an exemption', () => {
    const files = arrange({
      cases: [{id: 'linear/get-issue', provider: 'linear', steps: [{tool: 'get_issue'}]}],
      exemptions: [{id: 'gitea/all', provider: 'gitea'}],
    });

    expect(uncoveredUnits({grants, files}).map(({key}) => key)).toEqual([
      'linear.save_issue',
      'github.issue_read#get',
      'github.issue_read#get_comments',
    ]);
  });
});

describe('the committed contracts', () => {
  it('cover the tool catalog', async () => {
    const coverage = checkContractCoverage({grants: toolGrants, files: await loadContracts()});

    process.stdout.write(`${formatContractCoverageReport(coverage)}\n`);
    expect(coverage.problems).toEqual([]);
  });
});
