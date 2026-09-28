// This action runs in the job that holds the changes, next to whatever else that job executes.
// It imports only its own files and Node built-ins, so no workspace package runs with its grants.
import {defineAction, ToolCallError, type Tools} from '@shipfox/actions';
import {collectChanges} from './changes.ts';

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

// create_commit accepts at most this many decoded bytes of file contents per call.
const MAX_COMMIT_BYTES = 1_000_000;
const STALE_HEAD_ERROR = /stale-head|Expected branch to point to/u;

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

  const [headline = '', ...body] = inputs.message.split('\n');
  try {
    const result = await tools.github.call(
      'create_commit',
      {
        repository: inputs.repository,
        branch: target.branch,
        expected_head_oid: expectedHead,
        message: {headline, ...(body.length === 0 ? {} : {body: body.join('\n').trim()})},
        additions: changes.additions,
        deletions: changes.deletions,
      },
      {signal},
    );
    const {commit} = result.structured as {commit: {oid: string; url: string}};
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
    if (STALE_HEAD_ERROR.test(error.message)) {
      throw staleHead(target.branch, expectedHead, error);
    }
    throw error;
  }
});

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
