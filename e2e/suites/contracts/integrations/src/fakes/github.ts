import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  type GithubApiMock,
  type GithubIssueFixture,
  type GithubPullRequestFixture,
  startGithubApiMock,
} from '@shipfox/e2e-driver-github';
import {
  type ContractFakeAdapter,
  ephemeralEndpoint,
  field,
  inaccessibleTargets,
  requiredField,
  type SandboxFixtures,
} from './shared.js';

/** What the GitHub tool adapter needs to act as the connection's installation. */
export interface GithubContractAccess {
  installationId: number;
  installationToken: string;
}

// What the sandbox's GitHub issues and pull requests are, among its fixtures. An issue fixture
// holds an `open` issue unless its name says it is closed, and a pull request fixture holds an
// open pull request unless its name says closed or merged.
const GITHUB_ISSUE_FIXTURES = ['issue', 'closed_issue', 'parent_issue', 'sub_issue'] as const;
const GITHUB_PULL_REQUEST_FIXTURES = [
  'pull_request',
  'closed_pull_request',
  'merged_pull_request',
] as const;

const GITHUB_PARENT_FIXTURE = 'parent_issue';
const GITHUB_SUB_ISSUE_FIXTURE = 'sub_issue';
const GITHUB_ISSUE_COMMENT_FIXTURE = 'issue_comment';
const GITHUB_SANDBOX_AUTHOR = 'e2e-author';
const GITHUB_SANDBOX_REVIEWER = 'e2e-reviewer';
// The checks the sandbox workflow reports on the head of the open pull request: its two jobs.
const GITHUB_OPEN_PULL_REQUEST_CHECK_RUNS = [{name: 'build'}, {name: 'verify'}];

// What the sandbox's open pull request changes, which the pull request read cases assert on.
const GITHUB_OPEN_PULL_REQUEST_FILES = [
  {
    filename: 'fixtures/notes.md',
    status: 'modified',
    patch: '@@ -1,3 +1,4 @@\n # Notes\n \n-Three notes.\n+Four notes.\n+Why four?',
  },
  {filename: 'fixtures/extra.txt', status: 'added', patch: '@@ -0,0 +1 @@\n+Extra file.'},
] as const;

function gitSha(seed: string): string {
  return createHash('sha1').update(seed).digest('hex');
}

function seedGithubIssues({
  mock,
  repository,
  fixtures,
}: {
  mock: GithubApiMock;
  repository: string;
  fixtures: SandboxFixtures;
}): void {
  for (const fixtureName of GITHUB_ISSUE_FIXTURES) {
    const fixture = fixtures[fixtureName];
    if (fixture === undefined) continue;
    const number = Number(requiredField({fixture, fixtureName, name: 'number'}));
    mock.issues.set(number, githubIssue({repository, fixtures, fixtureName, fixture}));
  }
}

function githubIssue({
  repository,
  fixtures,
  fixtureName,
  fixture,
}: {
  repository: string;
  fixtures: SandboxFixtures;
  fixtureName: (typeof GITHUB_ISSUE_FIXTURES)[number];
  fixture: SandboxFixtures[string];
}): GithubIssueFixture {
  const number = Number(requiredField({fixture, fixtureName, name: 'number'}));
  const title = field({fixture, name: 'title'});
  const body = field({fixture, name: 'body'});
  const label = field({fixture: fixtures.label ?? {}, name: 'name'});
  const parent =
    fixtureName === GITHUB_SUB_ISSUE_FIXTURE ? fixtures[GITHUB_PARENT_FIXTURE] : undefined;
  const comments = githubIssueComments({
    fixture,
    first: fixtureName === 'issue' ? fixtures[GITHUB_ISSUE_COMMENT_FIXTURE] : undefined,
  });
  return {
    repository,
    title: title === undefined ? `Contract fixture issue ${number}` : String(title),
    ...(body === undefined ? {} : {body: String(body)}),
    ...(fixtureName === 'closed_issue' || field({fixture, name: 'state'}) === 'closed'
      ? {state: 'closed'}
      : {}),
    // The sandbox puts its label on the first fixture issue.
    ...(fixtureName === 'issue' && label !== undefined ? {labels: [String(label)]} : {}),
    ...(parent === undefined
      ? {}
      : {
          parent: Number(
            requiredField({fixture: parent, fixtureName: GITHUB_PARENT_FIXTURE, name: 'number'}),
          ),
        }),
    ...(comments.length === 0 ? {} : {comments}),
  };
}

// The sandbox comments carry non-ASCII text from the first one, so a read proves the encoding.
// The `issue_comment` fixture is the first comment of the `issue` fixture, with its id, author, and
// body.
function githubIssueComments({
  fixture,
  first,
}: {
  fixture: SandboxFixtures[string];
  first: SandboxFixtures[string] | undefined;
}) {
  const count = Number(field({fixture, name: 'comment_count'}) ?? 0);
  return Array.from({length: count}, (_, index) => ({
    id: index + 1,
    body: `Comment ${index + 1}: café 日本語`,
    author: GITHUB_SANDBOX_AUTHOR,
    ...(index === 0 && first !== undefined
      ? {
          id: Number(
            requiredField({fixture: first, fixtureName: GITHUB_ISSUE_COMMENT_FIXTURE, name: 'id'}),
          ),
          author: String(field({fixture: first, name: 'author'}) ?? GITHUB_SANDBOX_AUTHOR),
          body: String(
            field({fixture: first, name: 'body'}) ?? `Comment ${index + 1}: café 日本語`,
          ),
        }
      : {}),
  }));
}

// The branch and the commit fixtures. The sandbox pins their ids, so the fake reports those ids
// and not the ones a git repository would give. The commit sits on top of its base commit.
function seedGithubCommits({
  mock,
  repository,
  fixtures,
}: {
  mock: GithubApiMock;
  repository: string;
  fixtures: SandboxFixtures;
}): void {
  const {commit, branch} = fixtures;
  if (commit !== undefined) {
    const oid = String(requiredField({fixture: commit, fixtureName: 'commit', name: 'oid'}));
    const baseOid = field({fixture: commit, name: 'base_oid'});
    if (baseOid !== undefined) {
      mock.commits.set(String(baseOid), {repository, message: 'Seed the fixture repository'});
    }
    mock.commits.set(oid, {
      repository,
      message: String(field({fixture: commit, name: 'message'}) ?? `Commit ${oid}`),
      ...(baseOid === undefined ? {} : {parents: [String(baseOid)]}),
    });
  }
  if (branch !== undefined) {
    const name = String(requiredField({fixture: branch, fixtureName: 'branch', name: 'name'}));
    const oid = String(requiredField({fixture: branch, fixtureName: 'branch', name: 'oid'}));
    if (!mock.commits.has(oid)) mock.commits.set(oid, {repository, message: `Tip of ${name}`});
    mock.branchHeads.set(name, oid);
  }
}

// The review of the sandbox's open pull request: a plain comment, a review with two threads (one
// answered, one resolved), and the check runs of its head commit.
function seedGithubOpenPullRequest({
  mock,
  number,
  pullRequest,
}: {
  mock: GithubApiMock;
  number: number;
  pullRequest: GithubPullRequestFixture;
}): void {
  const head = mock.commits.get(pullRequest.sha);
  if (head !== undefined) {
    head.checkRuns = [...GITHUB_OPEN_PULL_REQUEST_CHECK_RUNS];
    pullRequest.commits = [pullRequest.sha];
  }
  pullRequest.files = GITHUB_OPEN_PULL_REQUEST_FILES.map((file) => ({...file}));
  pullRequest.comments = [
    {id: 9001, body: 'A plain pull request comment.', author: GITHUB_SANDBOX_AUTHOR},
  ];
  pullRequest.reviews = [{id: 8001, body: 'Review with threads.', author: GITHUB_SANDBOX_REVIEWER}];
  const path = GITHUB_OPEN_PULL_REQUEST_FILES[0].filename;
  mock.reviewThreads.set(`PRRT_contract_${number}_1`, {
    pullNumber: number,
    path,
    comments: [
      {id: 7001, body: 'First thread: why four?', author: GITHUB_SANDBOX_REVIEWER},
      {id: 7002, body: 'Because four reads better.', author: GITHUB_SANDBOX_AUTHOR},
    ],
  });
  mock.reviewThreads.set(`PRRT_contract_${number}_2`, {
    pullNumber: number,
    path,
    isResolved: true,
    comments: [{id: 7003, body: 'Second thread: a typo.', author: GITHUB_SANDBOX_REVIEWER}],
  });
}

function seedGithubPullRequests({
  mock,
  repository,
  fixtures,
}: {
  mock: GithubApiMock;
  repository: string;
  fixtures: SandboxFixtures;
}): void {
  for (const fixtureName of GITHUB_PULL_REQUEST_FIXTURES) {
    const fixture = fixtures[fixtureName];
    if (fixture === undefined) continue;
    const number = Number(requiredField({fixture, fixtureName, name: 'number'}));
    const ref = String(field({fixture, name: 'head_ref'}) ?? `contract/pull-request-${number}`);
    const pullRequest: GithubPullRequestFixture = {
      repository,
      ref,
      // A branch the sandbox pins reports its pinned tip, which the status and checks read.
      sha: mock.branchHeads.get(ref) ?? gitSha(`${repository}#${number}`),
      title: String(requiredField({fixture, fixtureName, name: 'title'})),
      state: fixtureName === 'pull_request' ? 'open' : 'closed',
      merged: fixtureName === 'merged_pull_request',
    };
    mock.pullRequests.set(number, pullRequest);
    if (fixtureName === 'pull_request') seedGithubOpenPullRequest({mock, number, pullRequest});
  }
}

const GITHUB_FIRST_RUN_ID = 25_000_000_000;

function seedGithubWorkflow({
  mock,
  repository,
  workflow,
}: {
  mock: GithubApiMock;
  repository: string;
  workflow: SandboxFixtures[string];
}): void {
  const required = (name: string) =>
    requiredField({fixture: workflow, fixtureName: 'workflow', name});
  const id = Number(required('id'));
  mock.workflows.set(id, {
    repository,
    name: String(required('name')),
    file: String(required('file')),
  });
  // Runs expire in the sandbox, and the cases read the second newest completed one, because the
  // newest may still be running. Each run has the jobs and the artifact the sandbox workflow makes.
  for (const offset of [1, 2]) {
    mock.workflowRuns.set(GITHUB_FIRST_RUN_ID + offset, {
      workflowId: id,
      sha: gitSha(`${repository}@${id}`),
      jobs: [
        {name: 'build', steps: ['Set up job', 'Run actions/checkout', 'Build', 'Complete job']},
        {name: 'verify', steps: ['Set up job', 'Verify', 'Complete job'], logs: 'Verified\n'},
      ],
      artifacts: [{name: 'report', sizeInBytes: 2048}],
    });
  }
}

// The sandbox's trigger workflow runs only when a case dispatches it. Its run is titled with the
// `marker` input, and its `outcome` input picks whether the run fails at once or keeps running.
function seedGithubTriggerWorkflow({
  mock,
  repository,
  workflow,
}: {
  mock: GithubApiMock;
  repository: string;
  workflow: SandboxFixtures[string];
}): void {
  const required = (name: string) =>
    requiredField({fixture: workflow, fixtureName: 'trigger_workflow', name});
  mock.workflows.set(Number(required('id')), {
    repository,
    name: String(required('name')),
    file: String(required('file')),
    runName: `${String(required('name'))} \${{ inputs.marker }}`,
    outcomeInput: 'outcome',
  });
}

/**
 * GitHub, whose fake the run already started for the project. It seeds the `repository` fixture as
 * a repository of the fake, the issue fixtures as its issues, the pull request fixtures as its pull
 * requests, the `branch` and `commit` fixtures as a branch tip and its commit, and the `workflow`
 * fixture as a workflow with two completed runs, and the `trigger_workflow` fixture as a workflow
 * with none, which a dispatch starts. The `label` fixture goes on the `issue` fixture,
 * the `issue` fixture gets its `comment_count` comments, the first one with the id and author of
 * the `issue_comment` fixture, and `sub_issue` is a sub-issue of
 * `parent_issue`. The open pull request gets the files, review, and check runs the sandbox holds.
 */
export const githubContractFake: ContractFakeAdapter<GithubContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const mock = await startGithubApiMock({
    endpoint: ephemeralEndpoint(),
    installationId,
    installationToken,
  });
  cleanups.push(() => mock.stop());
  // GitHub answers 404 for a repository that does not exist, and so does the fake once the
  // sandbox repository is the only one it knows.
  mock.access.rejectUnseeded = true;
  return {
    // The API edits only the comments its own app wrote, and the fake writes them as this app.
    env: {GITHUB_API_BASE_URL: mock.endpoint.toString(), GITHUB_APP_USERNAME: 'shipfox-e2e'},
    access: {installationId, installationToken},
    deny: (targets) => {
      for (const target of inaccessibleTargets(targets)) {
        const owner = field({fixture: target, name: 'owner'});
        const name = field({fixture: target, name: 'name'});
        if (owner !== undefined && name !== undefined) mock.access.denied.add(`${owner}/${name}`);
      }
    },
    seed: async (fixtures) => {
      const repository = fixtures.repository;
      if (repository === undefined) {
        const orphan = [
          ...GITHUB_ISSUE_FIXTURES,
          ...GITHUB_PULL_REQUEST_FIXTURES,
          'branch',
          'commit',
          'workflow',
          'trigger_workflow',
        ].find((fixtureName) => fixtures[fixtureName] !== undefined);
        if (orphan !== undefined) {
          throw new Error(`The github ${orphan} fixture needs a repository fixture.`);
        }
        return;
      }
      const owner = String(
        requiredField({fixture: repository, fixtureName: 'repository', name: 'owner'}),
      );
      const name = String(
        requiredField({fixture: repository, fixtureName: 'repository', name: 'name'}),
      );
      const seedDirectory = await mkdtemp(join(tmpdir(), 'contracts-repository-'));
      cleanups.push(() => rm(seedDirectory, {recursive: true, force: true}));
      await writeFile(join(seedDirectory, 'README.md'), '# Contracts sandbox\n');
      const added = await mock.addRepository({owner, name, seedDirectory});
      seedGithubIssues({mock, repository: added.fullName, fixtures});
      seedGithubCommits({mock, repository: added.fullName, fixtures});
      seedGithubPullRequests({mock, repository: added.fullName, fixtures});
      if (fixtures.workflow !== undefined) {
        seedGithubWorkflow({mock, repository: added.fullName, workflow: fixtures.workflow});
      }
      if (fixtures.trigger_workflow !== undefined) {
        seedGithubTriggerWorkflow({
          mock,
          repository: added.fullName,
          workflow: fixtures.trigger_workflow,
        });
      }
    },
    writes: () => mock.writes(),
  };
};
