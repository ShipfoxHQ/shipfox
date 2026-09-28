import {readdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import type {LinearWorkspaceFixture} from './linear-mcp.js';
import type {SlackThreadPage} from './slack-api.js';
import type {WorkflowProjectFile} from './workflow-project.js';

export type ReferenceActionName = 'slack-thread' | 'verified-commit' | 'linear-context';

const referenceActionsDir = fileURLToPath(new URL('../reference-actions/', import.meta.url));

/** The recipe's files, placed where a repository keeps its actions. */
export async function referenceActionFiles(
  name: ReferenceActionName,
): Promise<WorkflowProjectFile[]> {
  const directory = `${referenceActionsDir}${name}/`;
  const entries = await readdir(directory, {recursive: true, withFileTypes: true});
  return await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const path = `${entry.parentPath}/${entry.name}`.slice(directory.length);
        return {
          path: `.shipfox/actions/${name}/${path}`,
          content: await readFile(`${directory}${path}`, 'utf8'),
        };
      }),
  );
}

/**
 * Deterministic bytes that are not valid UTF-8, so the commit action must send them as base64.
 * The workflow writes the same bytes with the same generator inlined in a `node -e` step.
 */
export function pseudoRandomBytes(length: number): Buffer {
  const bytes = Buffer.alloc(length);
  let state = 42;
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

export function pseudoRandomBytesScript(params: {path: string; length: number}): string {
  return (
    `node -e "const b=Buffer.alloc(${params.length});let s=42;` +
    'for(let i=0;i<b.length;i++){s=(Math.imul(s,1103515245)+12345)>>>0;b[i]=s>>>24}' +
    `require('fs').mkdirSync(require('path').dirname('${params.path}'),{recursive:true});` +
    `require('fs').writeFileSync('${params.path}',b)"`
  );
}

export const SLACK_THREAD_TS = '1721300000.000100';

/**
 * Three pages, served out of order, with one reply repeated across pages. The export must hold
 * five messages in time order.
 */
export const SLACK_THREAD_PAGES: Readonly<Record<string, SlackThreadPage>> = {
  '': {
    messages: [
      {
        type: 'message',
        ts: SLACK_THREAD_TS,
        user: 'U0ALICE',
        text: 'Deploy failed',
        reply_count: 4,
      },
      {type: 'message', ts: '1721300000.000300', user: 'U0BOB', text: 'Rolled back'},
    ],
    nextCursor: 'page-2',
  },
  'page-2': {
    messages: [
      {type: 'message', ts: '1721300000.000200', user: 'U0BOB', text: 'Looking into it'},
      {type: 'message', ts: '1721300000.000300', user: 'U0BOB', text: 'Rolled back'},
    ],
    nextCursor: 'page-3',
  },
  'page-3': {
    messages: [
      {
        type: 'message',
        ts: '1721300000.000400',
        user: 'U0GHOST',
        text: 'Trace attached',
        files: [{name: 'trace.log', permalink: 'https://e2e.slack.com/files/trace.log'}],
      },
      {type: 'message', ts: '1721300000.000500', user: 'U0ALICE', text: 'Fixed forward'},
    ],
  },
};

/** U0GHOST is left out, so its lookup fails and the export credits the bare user ID. */
export const SLACK_USERS: Readonly<Record<string, Record<string, unknown>>> = {
  U0ALICE: {id: 'U0ALICE', name: 'alice', profile: {display_name: 'Alice'}},
  U0BOB: {id: 'U0BOB', name: 'bob', profile: {display_name: '', real_name: 'Bob Builder'}},
};

export const LINEAR_ROOT_PROJECT = {id: 'project-root', name: 'Root project'};
export const LINEAR_OTHER_PROJECT = {id: 'project-other', name: 'Other project'};

/**
 * A graph around ENG-1 in the root project:
 * - relations reach ENG-2 (same project) and ENG-3 (other project), and ENG-3 reaches ENG-6;
 * - ENG-4 is the parent and ENG-5 a sub-issue;
 * - ENG-1 → ENG-2 → ENG-5 → ENG-2 and ENG-3 ↔ ENG-6 are cycles;
 * - ENG-7 joins only through the root project; ENG-8 and doc-other sit in the other project,
 *   which is never expanded; ENG-99 is only mentioned in text;
 * - ENG-20, in a third project, links a file the uploads server does not have.
 */
export function linearContextWorkspace(uploadsUrl: URL): LinearWorkspaceFixture {
  const upload = (path: string) =>
    `${new URL(path, uploadsUrl).href}?signature=signed-${path.length}`;
  const pdf = upload('e2e-org/report/report.pdf');
  const png = upload('e2e-org/diagram/diagram.png');
  const txt = upload('e2e-org/notes/notes.txt');
  const missing = upload('e2e-org/missing/gone.pdf');
  const root = {project: LINEAR_ROOT_PROJECT.name, projectId: LINEAR_ROOT_PROJECT.id};
  const other = {project: LINEAR_OTHER_PROJECT.name, projectId: LINEAR_OTHER_PROJECT.id};
  const relations = (value: Record<string, {id: string}[]>) => ({
    relations: {blocks: [], blockedBy: [], relatedTo: [], duplicateOf: null, ...value},
  });
  const issue = (id: string, fields: Record<string, unknown>) => ({
    id,
    title: `${id} title`,
    url: `https://linear.app/e2e/issue/${id}`,
    status: 'Todo',
    assignee: 'E2E Assignee',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    attachments: [],
    documents: [],
    ...relations({}),
    ...fields,
  });

  return {
    issues: {
      'ENG-1': issue('ENG-1', {
        ...root,
        parentId: 'ENG-4',
        description:
          'Root issue. See <issue id="uuid-99" href="https://linear.app/e2e/issue/ENG-99">ENG-99</issue>.\n\n' +
          `<linear-embed node-type="file">{"href": "${pdf}", "name": "report.pdf"}</linear-embed>`,
        attachments: [{title: 'diagram.png', url: png}],
        documents: [{id: 'doc-issue', title: 'Issue notes'}],
        ...relations({blocks: [{id: 'ENG-2'}], relatedTo: [{id: 'ENG-3'}]}),
      }),
      'ENG-2': issue('ENG-2', {
        ...root,
        ...relations({blockedBy: [{id: 'ENG-1'}, {id: 'ENG-5'}]}),
      }),
      'ENG-3': issue('ENG-3', {
        ...other,
        ...relations({relatedTo: [{id: 'ENG-1'}, {id: 'ENG-6'}]}),
      }),
      'ENG-4': issue('ENG-4', {...root}),
      'ENG-5': issue('ENG-5', {
        ...root,
        parentId: 'ENG-1',
        ...relations({blocks: [{id: 'ENG-2'}]}),
      }),
      'ENG-6': issue('ENG-6', {...other, ...relations({relatedTo: [{id: 'ENG-3'}]})}),
      'ENG-7': issue('ENG-7', {...root}),
      'ENG-8': issue('ENG-8', {...other}),
      'ENG-99': issue('ENG-99', {...other}),
      'ENG-20': issue('ENG-20', {
        project: 'Partial project',
        projectId: 'project-partial',
        description: `Needs [the lost file](${missing}).`,
      }),
    },
    documents: {
      'doc-project': {
        id: 'doc-project',
        title: 'Runbook',
        projectId: LINEAR_ROOT_PROJECT.id,
        content: `Runbook body. Notes: [notes.txt](${txt})`,
      },
      'doc-issue': {id: 'doc-issue', title: 'Issue notes', content: 'Issue document body.'},
      'doc-other': {
        id: 'doc-other',
        title: 'Other doc',
        projectId: LINEAR_OTHER_PROJECT.id,
        content: 'Never exported.',
      },
    },
    comments: {
      'issue:ENG-1': [
        {id: 'c1', body: 'First comment', author: {name: 'Ada'}, createdAt: '2026-09-03T00:00:00Z'},
        {
          id: 'c2',
          body: `Reply with [notes](${txt})`,
          author: {name: 'Grace'},
          createdAt: '2026-09-04T00:00:00Z',
          parentId: 'c1',
        },
        {id: 'c3', body: 'Third comment', author: {name: 'Ada'}, createdAt: '2026-09-05T00:00:00Z'},
      ],
      'document:doc-project': [
        {
          id: 'd1',
          body: 'Document comment',
          author: {name: 'Linus'},
          createdAt: '2026-09-06T00:00:00Z',
        },
      ],
    },
  };
}
