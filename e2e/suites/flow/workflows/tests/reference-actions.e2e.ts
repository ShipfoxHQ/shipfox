import {createHash} from 'node:crypto';
import {createApiClient} from '@shipfox/e2e-core';
import {type ConnectedOrg, createConnectedOrg, deleteOrg} from '@shipfox/e2e-driver-gitea';
import {type GithubApiMockCall, startGithubApiMock} from '@shipfox/e2e-driver-github';
import {LINEAR_UPLOADS_PATH, startLinearMcpMock} from '@shipfox/e2e-driver-linear';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {startSlackApiMock} from '@shipfox/e2e-driver-slack';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import type {WorkflowRunObservation, WorkflowStepObservation} from '@shipfox/e2e-observe-workflows';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {
  createGithubConnection,
  createLinearConnection,
  createSlackConnection,
} from '@shipfox/e2e-setup-integrations';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {logText} from '#expect.js';
import {
  LINEAR_ROOT_PROJECT,
  linearContextWorkspace,
  pseudoRandomBytes,
  pseudoRandomBytesScript,
  type ReferenceActionName,
  referenceActionFiles,
  SLACK_THREAD_PAGES,
  SLACK_THREAD_TS,
  SLACK_USERS,
} from '#reference-actions.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

// The three reference actions, run as a user would: synced from the repository, against the
// Slack, GitHub, and Linear mocks. Their sources under reference-actions/ are the docs recipes.

const RUN_TIMEOUT_MS = 180_000;
const GITHUB_REPOSITORY = 'shipfox/e2e';
const BLOB_BYTES = 900 * 1024;
const OVERSIZED_BYTES = 1_100_000;

// The API calls each provider mock at one address, so these tests take turns on the ports.
test.describe.configure({mode: 'serial'});

type Attach = (
  name: string,
  options: {body: Buffer | string; contentType: string},
) => Promise<void>;

interface ReferenceRun {
  observation: WorkflowRunObservation;
  headSha: string;
  token: string;
}

/** Seeds a repository with the workflow and actions, then runs it once by hand. */
async function runReferenceWorkflow(params: {
  suite: SuiteContext;
  attach: Attach;
  name: string;
  workflowYaml: string;
  actions: ReferenceActionName[];
  /** Step keys to observe, by job key. */
  steps: Record<string, string[]>;
  extraFiles?: {path: string; content: string}[];
  beforeRun?: (headSha: string) => void;
}): Promise<ReferenceRun> {
  const token = params.suite.sessionToken;
  const uniqueId = shortId();
  const runnerLabel = `e2e-${params.name}-${uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${params.name} ${uniqueId}`,
    runnerLabel,
  });
  try {
    const actionFiles = await Promise.all(params.actions.map(referenceActionFiles));
    // Only a definition sync snapshots actions, so the definition comes from the repository.
    const seeded = await seedAndWaitForDefinition({
      suite: params.suite,
      token,
      name: params.name,
      repo: `${params.name}-${uniqueId}`,
      runnerLabel,
      workflowYaml: params.workflowYaml,
      configPath: `.shipfox/workflows/${params.name}.yml`,
      extraFiles: [...actionFiles.flat(), ...(params.extraFiles ?? [])],
    });
    if (seeded.headSha === undefined) throw new Error('The seed commit is missing.');
    params.beforeRun?.(seeded.headSha);
    const runId = await fireManualAndAwaitRun({
      client: createApiClient({token}),
      definitionId: seeded.definition.id,
      inputs: {},
      scenario: params.name,
    });
    const observation = await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: RUN_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: Object.entries(params.steps).map(([jobKey, stepKeys]) => ({
          jobKey,
          includeDefaultExecution: true,
          stepKeys,
        })),
      },
    });
    // Several jobs fail on purpose, so every observed step's log is kept for diagnosis.
    for (const request of collectStepLogAttachmentRequests(observation)) {
      const attachment = await fetchLogAttachment(request, token);
      await params.attach(attachment.name, {
        body: attachment.body,
        contentType: attachment.contentType,
      });
    }
    return {observation, headSha: seeded.headSha, token};
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        params.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch(() => undefined);
  }
}

function findStep(
  observation: WorkflowRunObservation,
  jobKey: string,
  stepKey: string,
): WorkflowStepObservation {
  const step = observation.jobs
    .find((job) => job.key === jobKey)
    ?.executions.flatMap((execution) => execution.steps)
    .find((candidate) => candidate.key === stepKey);
  if (step === undefined) throw new Error(`Step ${jobKey}.${stepKey} is missing`);
  return step;
}

async function stepLogs(run: ReferenceRun, jobKey: string, stepKey: string): Promise<string> {
  const step = findStep(run.observation, jobKey, stepKey);
  const logs = await fetchStepLogs({
    stepId: step.id,
    attempt: step.current_attempt,
    token: run.token,
  });
  return logText(logs.records);
}

function shortId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 10);
}

test('the Slack thread action exports every page of a thread', async ({suite}, testInfo) => {
  const channel = `C${shortId().toUpperCase()}`;
  const slackApi = await startSlackApiMock({threadPages: SLACK_THREAD_PAGES, users: SLACK_USERS});
  try {
    const uniqueId = shortId();
    const connection = await createSlackConnection({
      workspaceId: suite.workspaceId,
      teamId: `T${uniqueId}`,
      teamName: `E2E Slack ${uniqueId}`,
      appId: `A${uniqueId}`,
      botUserId: `Ubot${uniqueId}`,
      botToken: `xoxb-e2e-${uniqueId}`,
      scopes: ['channels:history', 'users:read'],
    });

    const run = await runReferenceWorkflow({
      suite,
      attach: (name, options) => testInfo.attach(name, options),
      name: 'reference-slack-thread',
      actions: ['slack-thread'],
      steps: {export: ['thread', 'check']},
      workflowYaml: `
name: Slack thread reference action
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  export:
    steps:
      - key: thread
        uses: ./.shipfox/actions/slack-thread
        connections:
          slack: ${connection.slug}
        with:
          channel_id: ${channel}
          thread_ts: '${SLACK_THREAD_TS}'
          destination: context/thread.md
      - key: check
        run: |
          set -eu
          test ! -e context/thread.md.tmp
          grep -q 'Complete: 5 messages, the parent and 4 replies.' context/thread.md
          order=$(grep -o '\\[ts [0-9.]*\\]' context/thread.md | tr '\\n' ' ')
          test "$order" = "[ts 1721300000.000100] [ts 1721300000.000200] [ts 1721300000.000300] [ts 1721300000.000400] [ts 1721300000.000500] "
          test "$(grep -c '^## ' context/thread.md)" = 5
          grep -q '^## Alice, 2024-07-18T10:53:20Z' context/thread.md
          grep -q '^## Bob Builder, ' context/thread.md
          grep -q '^## U0GHOST, ' context/thread.md
          grep -q '(https://e2e.slack.com/archives/${channel}/p1721300000000400)' context/thread.md
          grep -q 'File: \\[trace.log\\](https://e2e.slack.com/files/trace.log)' context/thread.md
          echo "slack thread export verified"
`,
    });

    expect(run.observation.status).toBe('succeeded');
    expect(findStep(run.observation, 'export', 'thread').outputs).toEqual({
      path: 'context/thread.md',
      message_count: 5,
      complete: true,
    });
    expect(await stepLogs(run, 'export', 'check')).toContain('slack thread export verified');
    const replies = slackApi.calls.filter((call) => call.kind === 'conversations.replies');
    expect(replies.map((call) => call.cursor)).toEqual([undefined, 'page-2', 'page-3']);
    expect(replies.every((call) => call.channel === channel && call.ts === SLACK_THREAD_TS)).toBe(
      true,
    );
    const lookups = slackApi.calls.flatMap((call) =>
      call.kind === 'users.info' ? [call.user] : [],
    );
    expect(lookups.sort()).toEqual(['U0ALICE', 'U0BOB', 'U0GHOST']);
  } finally {
    await slackApi.stop();
  }
});

test('the verified commit action publishes a pull request change whole or not at all', async ({
  suite,
}, testInfo) => {
  const uniqueId = shortId();
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;
  const githubApi = await startGithubApiMock({installationId, installationToken});
  let org: ConnectedOrg | undefined;
  try {
    // A GitHub connection resyncs every project in its workspace when it becomes available, so
    // this test gets a workspace, and a gitea org, of its own.
    const user = await createUser({name: `Reference actions ${uniqueId}`});
    const workspace = await createWorkspace({
      userId: user.user.id,
      userEmail: user.email,
      name: `Reference actions ${uniqueId}`,
    });
    const session = await createSession({user_id: user.user.id});
    org = await createConnectedOrg({workspaceId: workspace.id, sessionToken: session.token});
    const isolatedSuite: SuiteContext = {
      ...suite,
      userId: user.user.id,
      workspaceId: workspace.id,
      sessionToken: session.token,
      org: org.org,
      connectionId: org.connection.id,
      connectionSlug: org.connection.slug,
    };
    const connection = await createGithubConnection({
      workspaceId: workspace.id,
      installationId,
      accountLogin: 'shipfox',
      displayName: `GitHub reference actions ${uniqueId}`,
      installerUserId: crypto.randomUUID(),
    });
    // The pull request repository is not a Shipfox project, so the connection allows all.
    await createApiClient({token: session.token}).request(
      'put',
      `/integration-connections/${connection.id}/repository-access`,
      {json: {mode: 'all'}},
    );

    const commitStep = (pullRequest: number) => `
      - key: commit
        uses: ./.shipfox/actions/verified-commit
        connections:
          github: ${connection.slug}
        with:
          repository: ${GITHUB_REPOSITORY}
          pull_request: ${pullRequest}
          message: |
            Publish generated assets

            Made by the E2E suite.`;
    const run = await runReferenceWorkflow({
      suite: isolatedSuite,
      attach: (name, options) => testInfo.attach(name, options),
      name: 'reference-verified-commit',
      actions: ['verified-commit'],
      steps: {
        publish: ['change', 'commit', 'check'],
        stale: ['commit'],
        unchanged: ['commit'],
        oversized: ['commit'],
      },
      extraFiles: [
        {path: 'notes/obsolete.txt', content: 'Removed by the change.\n'},
        {path: 'notes/old-name.txt', content: 'Renamed by a local commit.\n'},
      ],
      beforeRun: (headSha) => {
        const pullRequests = [
          {number: 7, ref: 'e2e/publish', tip: headSha},
          // The branch moved after the pull request was read, so the commit must be refused.
          {number: 8, ref: 'e2e/moved', tip: 'f'.repeat(40)},
          {number: 9, ref: 'e2e/unchanged', tip: headSha},
          {number: 10, ref: 'e2e/oversized', tip: headSha},
        ];
        for (const pullRequest of pullRequests) {
          githubApi.pullRequests.set(pullRequest.number, {ref: pullRequest.ref, sha: headSha});
          githubApi.branchHeads.set(pullRequest.ref, pullRequest.tip);
        }
      },
      workflowYaml: `
name: Verified commit reference action
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  publish:
    steps:
      - key: change
        run: |
          set -eu
          ${pseudoRandomBytesScript({path: 'assets/blob.bin', length: BLOB_BYTES})}
          printf 'Release notes\\n' > notes/changelog.md
          rm notes/obsolete.txt
          git mv notes/old-name.txt notes/new-name.txt
          git -c user.name=E2E -c user.email=e2e@example.com -c commit.gpgsign=false commit -q -m 'Rename locally'
          git rev-parse HEAD > .git/e2e-local-head
${commitStep(7)}
      - key: check
        run: |
          set -eu
          test "$(git rev-parse HEAD)" = "$(cat .git/e2e-local-head)"
          test -f assets/blob.bin
          test -n "$(git status --porcelain)"
          echo "local checkout untouched"
  stale:
    steps:
      - run: printf 'Stale change\\n' > notes/stale.md
${commitStep(8)}
  unchanged:
    steps:
${commitStep(9)}
  oversized:
    steps:
      - run: |
          ${pseudoRandomBytesScript({path: 'assets/huge.bin', length: OVERSIZED_BYTES})}
${commitStep(10)}
`,
    });

    expect(run.observation.status).toBe('failed');
    expect(findStep(run.observation, 'publish', 'commit').outputs).toMatchObject({
      outcome: 'committed',
      branch: 'e2e/publish',
      commit_sha: githubApi.branchHeads.get('e2e/publish'),
    });
    expect(await stepLogs(run, 'publish', 'check')).toContain('local checkout untouched');
    expect(findStep(run.observation, 'unchanged', 'commit')).toMatchObject({
      status: 'succeeded',
      outputs: {outcome: 'no_changes', branch: 'e2e/unchanged'},
    });
    expect(findStep(run.observation, 'stale', 'commit').status).toBe('failed');
    expect(await stepLogs(run, 'stale', 'commit')).toContain(
      `Branch e2e/moved no longer points to ${run.headSha}`,
    );
    expect(findStep(run.observation, 'oversized', 'commit').status).toBe('failed');
    expect(await stepLogs(run, 'oversized', 'commit')).toContain(
      `holds ${OVERSIZED_BYTES} bytes of file contents, above the 1000000 bytes`,
    );

    // Only the publish job's commit landed; the stale one was refused and the rest never wrote.
    const commits = githubApi.calls.filter(
      (call): call is Extract<GithubApiMockCall, {kind: 'create-commit'}> =>
        call.kind === 'create-commit',
    );
    expect(commits.map((call) => [branchName(call.input), call.accepted])).toEqual(
      expect.arrayContaining([
        ['e2e/publish', true],
        ['e2e/moved', false],
      ]),
    );
    expect(commits).toHaveLength(2);
    const published = commits.find((call) => call.accepted);
    expect(published?.input).toMatchObject({
      branch: {repositoryNameWithOwner: GITHUB_REPOSITORY, branchName: 'e2e/publish'},
      expectedHeadOid: run.headSha,
      message: {headline: 'Publish generated assets', body: 'Made by the E2E suite.'},
      fileChanges: {
        deletions: [{path: 'notes/obsolete.txt'}, {path: 'notes/old-name.txt'}],
      },
    });
    const additions = fileAdditions(published?.input);
    expect([...additions.keys()]).toEqual([
      'assets/blob.bin',
      'notes/changelog.md',
      'notes/new-name.txt',
    ]);
    expect(sha256(additions.get('assets/blob.bin'))).toBe(sha256(pseudoRandomBytes(BLOB_BYTES)));
    expect(additions.get('notes/changelog.md')?.toString('utf8')).toBe('Release notes\n');
    expect(additions.get('notes/new-name.txt')?.toString('utf8')).toBe(
      'Renamed by a local commit.\n',
    );
  } finally {
    await githubApi.stop();
    if (org !== undefined) await deleteOrg({org: org.org}).catch(() => undefined);
  }
});

test('the Linear context action walks the issue graph and reports its gaps', async ({
  suite,
}, testInfo) => {
  const uploadsUrl = new URL(
    process.env.LINEAR_UPLOADS_URL ??
      new URL(LINEAR_UPLOADS_PATH, process.env.LINEAR_MCP_ENDPOINT).href,
  );
  const linear = await startLinearMcpMock({workspace: linearContextWorkspace(uploadsUrl)});
  try {
    const uniqueId = shortId();
    const connection = await createLinearConnection({
      workspaceId: suite.workspaceId,
      organizationId: `linear-org-${uniqueId}`,
      organizationUrlKey: `e2e-${uniqueId}`,
      appUserId: `linear-app-user-${uniqueId}`,
      displayName: `Linear reference actions ${uniqueId}`,
      accessToken: `linear-e2e-token-${uniqueId}`,
    });
    const exportStep = (issueId: string, allowPartial: boolean) => `
      - key: context
        uses: ./.shipfox/actions/linear-context
        connections:
          linear: ${connection.slug}
        with:
          issue_id: ${issueId}
          allow_partial: ${allowPartial}
          uploads_url: ${uploadsUrl.href}`;

    const run = await runReferenceWorkflow({
      suite,
      attach: (name, options) => testInfo.attach(name, options),
      name: 'reference-linear-context',
      actions: ['linear-context'],
      steps: {complete: ['context', 'check'], strict: ['context'], partial: ['context', 'check']},
      workflowYaml: `
name: Linear context reference action
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
jobs:
  complete:
    steps:
${exportStep('ENG-1', false)}
      - key: check
        run: |
          set -eu
          cd context/linear
          test -f ENG-1.md
          test -f coverage.json
          test -z "$(find . -name '*.tmp' -o -name '*.partial.md')"
          test "$(ls files | tr '\\n' ' ')" = 'diagram.png notes.txt report.pdf '
          grep -q '"href": "files/report.pdf"' ENG-1.md
          grep -q '\\[diagram.png\\](files/diagram.png)' ENG-1.md
          grep -q '\\[notes\\](files/notes.txt)' ENG-1.md
          if grep -q 'signature=' ENG-1.md; then exit 1; fi
          grep -q '^## ENG-3: ENG-3 title' ENG-1.md
          grep -q 'Project: Other project' ENG-1.md
          grep -q '^## Document: Runbook' ENG-1.md
          grep -q '^## Document: Issue notes' ENG-1.md
          grep -q '^\\*\\*Grace\\*\\*, 2026-09-04T00:00:00Z (reply):' ENG-1.md
          if grep -q 'ENG-8\\|ENG-99:\\|Other doc' ENG-1.md; then exit 1; fi
          node -e "
            const c = require('./coverage.json');
            const assert = require('node:assert/strict');
            assert.equal(c.complete, true);
            assert.equal(c.stopped, 'completed');
            assert.deepEqual(c.gaps, []);
            assert.deepEqual(c.root.project, {id: 'project-root', name: 'Root project'});
            assert.deepEqual(c.counts, {issues: 7, documents: 2, comments: 4, files: 3});
            assert.ok(c.collections.every((list) => list.exhausted));
            assert.ok(c.downloads.every((file) => file.status === 'downloaded' && /^[0-9a-f]{64}$/.test(file.sha256)));
          "
          echo "linear context export verified"
  strict:
    steps:
${exportStep('ENG-20', false)}
  partial:
    steps:
${exportStep('ENG-20', true)}
      - key: check
        run: |
          set -eu
          test -f context/linear/ENG-20.partial.md
          test ! -e context/linear/ENG-20.md
          node -e "
            const c = require('./context/linear/coverage.json');
            const assert = require('node:assert/strict');
            assert.equal(c.complete, false);
            assert.equal(c.gaps.length, 1);
            assert.equal(c.gaps[0].kind, 'download');
            assert.match(c.gaps[0].entity, /gone\\.pdf$/);
          "
          echo "partial linear export verified"
`,
    });

    expect(run.observation.status).toBe('failed');
    expect(findStep(run.observation, 'complete', 'context').outputs).toEqual({
      path: 'context/linear/ENG-1.md',
      coverage_path: 'context/linear/coverage.json',
      files_path: 'context/linear/files',
      complete: true,
      issue_count: 7,
      file_count: 3,
    });
    expect(await stepLogs(run, 'complete', 'check')).toContain('linear context export verified');
    expect(findStep(run.observation, 'strict', 'context')).toMatchObject({
      status: 'failed',
      outputs: {path: 'context/linear/ENG-20.partial.md', complete: false, file_count: 0},
    });
    expect(await stepLogs(run, 'strict', 'context')).toContain(
      'saved as context/linear/ENG-20.partial.md',
    );
    expect(findStep(run.observation, 'partial', 'context')).toMatchObject({
      status: 'succeeded',
      outputs: {path: 'context/linear/ENG-20.partial.md', complete: false, file_count: 0},
    });
    expect(await stepLogs(run, 'partial', 'check')).toContain('partial linear export verified');

    // Every issue is read once, so the cycles ended; only the root project was listed.
    const issueReads = linear.calls
      .filter((call) => call.toolName === 'get_issue')
      .map((call) => String(call.arguments.id));
    expect(issueReads.filter((id) => id !== 'ENG-20').sort()).toEqual([
      'ENG-1',
      'ENG-2',
      'ENG-3',
      'ENG-4',
      'ENG-5',
      'ENG-6',
      'ENG-7',
    ]);
    const listedProjects = linear.calls.flatMap((call) => {
      if (call.toolName === 'list_documents') return [call.arguments.projectId];
      if (call.toolName === 'list_issues' && call.arguments.project !== undefined) {
        return [call.arguments.project];
      }
      return [];
    });
    expect(new Set(listedProjects)).toEqual(new Set([LINEAR_ROOT_PROJECT.id, 'project-partial']));
    expect(
      linear.calls.some(
        (call) => call.toolName === 'get_document' && call.arguments.id === 'doc-other',
      ),
    ).toBe(false);
  } finally {
    await linear.stop();
  }
});

function branchName(input: Record<string, unknown>): unknown {
  const branch = input.branch as {branchName?: unknown} | undefined;
  return branch?.branchName;
}

function fileAdditions(input: Record<string, unknown> | undefined): Map<string, Buffer> {
  const fileChanges = input?.fileChanges as
    | {additions?: {path: string; contents: string}[]}
    | undefined;
  return new Map(
    (fileChanges?.additions ?? []).map((addition) => [
      addition.path,
      Buffer.from(addition.contents, 'base64'),
    ]),
  );
}

function sha256(value: Buffer | undefined): string {
  return createHash('sha256')
    .update(value ?? Buffer.alloc(0))
    .digest('hex');
}
