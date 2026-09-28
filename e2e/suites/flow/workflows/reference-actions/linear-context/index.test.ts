import {
  type ActionTestWorkspace,
  runAction,
  type ToolFakes,
  toolError,
  toolResult,
} from '@shipfox/actions/testing';
import type {LinearIssue} from './linear.ts';

const action = new URL('./', import.meta.url);

interface LinearWorld {
  issues: LinearIssue[];
  /** Issue IDs listed in each project. */
  projects?: Record<string, string[]>;
  download?: (url: string) => unknown;
}

describe('linear-context', () => {
  const workspaces: ActionTestWorkspace[] = [];

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => workspace.remove()));
  });

  it('reads each issue once when relations form a cycle', async () => {
    const result = await run({
      inputs: {issue_id: 'ENG-1'},
      world: {
        issues: [
          {id: 'ENG-1', title: 'Root', relations: {blocks: [{id: 'ENG-2'}]}},
          {
            id: 'ENG-2',
            title: 'Blocked',
            relations: {blockedBy: [{id: 'ENG-1'}]},
            parentId: 'ENG-1',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      outputs: {path: 'context/linear/ENG-1.md', complete: true, issue_count: 2},
    });
    const reads = result.calls.filter((call) => call.tool === 'get_issue');
    expect(reads.map((call) => call.args.id)).toEqual(['ENG-1', 'ENG-2']);
  });

  it("lists only the root issue's project", async () => {
    const result = await run({
      inputs: {issue_id: 'ENG-1'},
      world: {
        issues: [
          {
            id: 'ENG-1',
            title: 'Root',
            projectId: 'root-project',
            relations: {relatedTo: [{id: 'OPS-1'}]},
          },
          {id: 'ENG-2', title: 'Sibling', projectId: 'root-project'},
          {id: 'OPS-1', title: 'Elsewhere', projectId: 'other-project'},
          {id: 'OPS-2', title: 'Not followed', projectId: 'other-project'},
        ],
        projects: {'root-project': ['ENG-1', 'ENG-2'], 'other-project': ['OPS-1', 'OPS-2']},
      },
    });

    expect(result).toMatchObject({status: 'succeeded', outputs: {issue_count: 3}});
    const projectLists = result.calls.filter(
      (call) => call.args.project !== undefined || call.args.projectId !== undefined,
    );
    expect(projectLists.map((call) => call.args.project ?? call.args.projectId)).toEqual([
      'root-project',
      'root-project',
    ]);
  });

  describe('when a download fails', () => {
    const world: LinearWorld = {
      issues: [
        {
          id: 'ENG-1',
          title: 'Root',
          description: 'See https://uploads.linear.app/org/diagram.png?signature=abc',
        },
      ],
      download: () => {
        throw toolError({code: 'provider-unavailable', message: 'The upload link expired.'});
      },
    };

    it('fails the step', async () => {
      const result = await run({inputs: {issue_id: 'ENG-1'}, world});

      expect(result).toMatchObject({
        status: 'failed',
        outputs: {path: 'context/linear/ENG-1.partial.md', complete: false, file_count: 0},
      });
      expect(result.logs).toContain('Set allow_partial to accept a partial export.');
    });

    it('succeeds with complete set to false under allow_partial', async () => {
      const result = await run({inputs: {issue_id: 'ENG-1', allow_partial: true}, world});

      expect(result).toMatchObject({
        status: 'succeeded',
        outputs: {path: 'context/linear/ENG-1.partial.md', complete: false, file_count: 0},
      });
      const coverage = JSON.parse(await result.workspace.read('context/linear/coverage.json'));
      expect(coverage.downloads).toEqual([
        {
          url: 'https://uploads.linear.app/org/diagram.png',
          status: 'failed',
          error: 'linear.download_file: The upload link expired.',
        },
      ]);
    });
  });

  async function run(params: {inputs: Record<string, unknown>; world: LinearWorld}) {
    const result = await runAction(action, {inputs: params.inputs, tools: linear(params.world)});
    workspaces.push(result.workspace);
    return result;
  }
});

/** Answers the Linear tools from a fixed set of issues, one page per list. */
function linear(world: LinearWorld): ToolFakes {
  const page = (key: string, items: unknown[]) => toolResult({[key]: items, hasNextPage: false});
  return {
    linear: {
      get_issue: (args) => {
        const issue = world.issues.find((candidate) => candidate.id === args.id);
        if (issue === undefined)
          throw toolError({code: 'not-found', message: `No issue ${args.id}.`});
        return toolResult(issue);
      },
      list_issues: (args) => {
        if (typeof args.project === 'string') {
          const ids = world.projects?.[args.project] ?? [];
          return page(
            'issues',
            ids.map((id) => ({id})),
          );
        }
        return page(
          'issues',
          world.issues.filter((issue) => issue.parentId === args.parentId).map(({id}) => ({id})),
        );
      },
      list_documents: () => page('documents', []),
      list_comments: () => page('comments', []),
      download_file: (args) => world.download?.(String(args.url)) ?? 'file',
    },
  };
}
