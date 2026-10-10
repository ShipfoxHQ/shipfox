// This action runs in the job that holds the changes, next to whatever else that job executes.
// It imports only its own files and Node built-ins, so no workspace package runs with its grants.
import {defineAction, ToolCallError, type Tools} from '@shipfox/actions';
import {collectChanges, type FileAddition} from './changes.ts';

declare module '@shipfox/actions' {
  interface Aliases {
    github: 'github';
  }
}

type Inputs = {
  repository: string;
  pull_request?: number;
  branch?: string;
  expected_head?: string;
  message: string;
  paths?: string[];
};

// This reference action publishes small changes only.
const MAX_COMMIT_BYTES = 1_000_000;

export default defineAction<Inputs>(async ({inputs, tools, log, signal}) => {
  const target = await resolveTarget({inputs, tools, signal});
  if (inputs.expected_head !== undefined && target.head !== inputs.expected_head) {
    throw staleHead(target.branch, inputs.expected_head);
  }
  const expectedHead = inputs.expected_head ?? target.head;

  const changes = await collectChanges({base: expectedHead, paths: inputs.paths ?? []});
  if (changes.additions.length === 0 && changes.deletions.length === 0) {
    log.info(`No changes against ${expectedHead}; nothing to commit.`);
    return {outcome: 'no_changes', branch: target.branch};
  }
  if (changes.bytes > MAX_COMMIT_BYTES) {
    throw new Error(
      `The change holds ${changes.bytes} bytes of file contents, above the ${MAX_COMMIT_BYTES} ` +
        'bytes one verified commit can carry. Nothing was published. Publish fewer paths at once.',
    );
  }
  log.info(
    `Committing ${changes.additions.length} additions and ${changes.deletions.length} ` +
      `deletions (${changes.bytes} bytes) to ${target.branch} on top of ${expectedHead}.`,
  );

  try {
    const additions = await uploadAdditions({
      additions: changes.additions,
      repository: inputs.repository,
      tools,
      signal,
    });
    const deletions = changes.deletions.map((deletion) => ({path: deletion.path, delete: true}));
    const entries = [...additions, ...deletions];
    const result = await tools.github.call(
      'create_commit',
      {
        repository: inputs.repository,
        branch: target.branch,
        parent_oid: expectedHead,
        message: inputs.message,
        entries,
      },
      {signal},
    );
    const {commit} = result.structured;
    return {
      outcome: 'committed',
      branch: target.branch,
      commit_sha: commit.oid,
      commit_url: commit.url,
    };
  } catch (error) {
    if (!(error instanceof ToolCallError)) throw error;
    if (error.outcomeUnknown) {
      throw new Error(
        `The commit request reached GitHub but no answer came back, so it may have landed on ` +
          `${target.branch}. Check the branch before running this step again.`,
        {cause: error},
      );
    }
    if (error.reason === 'stale-head') {
      throw staleHead(target.branch, expectedHead, error);
    }
    throw error;
  }
});

// Text goes inline in the commit call. Binary contents are uploaded first and referenced.
async function uploadAdditions(params: {
  additions: FileAddition[];
  repository: string;
  tools: Tools;
  signal: AbortSignal;
}): Promise<({path: string; contents: string} | {path: string; oid: string})[]> {
  const entries: ({path: string; contents: string} | {path: string; oid: string})[] = [];
  for (const {path, contents, encoding} of params.additions) {
    if (encoding === 'utf8') {
      entries.push({path, contents});
      continue;
    }
    const blob = await params.tools.github.call(
      'create_blob',
      {repository: params.repository, contents, encoding},
      {signal: params.signal},
    );
    entries.push({path, oid: (blob.structured as {oid: string}).oid});
  }
  return entries;
}

async function resolveTarget(params: {
  inputs: Inputs;
  tools: Tools;
  signal: AbortSignal;
}): Promise<{branch: string; head: string}> {
  const {inputs} = params;
  if (inputs.pull_request === undefined) {
    if (inputs.branch === undefined || inputs.expected_head === undefined) {
      throw new Error('Set pull_request, or set both branch and expected_head.');
    }
    return {branch: inputs.branch, head: inputs.expected_head};
  }
  const [owner = '', repo = ''] = inputs.repository.split('/');
  const result = await params.tools.github.call(
    'pull_request_read.get',
    {owner, repo, pull_number: inputs.pull_request},
    {signal: params.signal},
  );
  const {head} = result.structured as {head: {ref: string; sha: string}};
  if (inputs.branch !== undefined && inputs.branch !== head.ref) {
    throw new Error(
      `Pull request #${inputs.pull_request} targets ${head.ref}, not branch ${inputs.branch}.`,
    );
  }
  return {branch: head.ref, head: head.sha};
}

function staleHead(branch: string, expectedHead: string, cause?: unknown): Error {
  return new Error(
    `Branch ${branch} no longer points to ${expectedHead}, so nothing was published. Check out ` +
      'the new head, recompute the change, and run again.',
    cause === undefined ? undefined : {cause},
  );
}
