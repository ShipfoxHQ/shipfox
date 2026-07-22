import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function run(command, args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => resolveCommand({code, stderr, stdout}));
  });
}

async function writeOutput(values) {
  const outputPath = argument('github-output');
  if (!outputPath) return;
  await writeFile(
    outputPath,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    {flag: 'a'},
  );
}

async function writeSummary(summary) {
  const summaryPath = argument('github-summary');
  if (!summaryPath) return;
  await writeFile(summaryPath, `${summary}\n`, {flag: 'a'});
}

async function plan() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'shipfox-release-plan-'));
  const outputPath = join(temporaryRoot, 'release-plan.json');
  try {
    const result = await run('pnpm', ['exec', 'changeset', 'status', '--output', outputPath]);
    const plan =
      result.code === 0 ? JSON.parse(await readFile(outputPath, 'utf8')) : {releases: []};
    const releases = Array.isArray(plan.releases) ? plan.releases : [];
    const hasChangesets = releases.length > 0;
    await writeOutput({has_changesets: String(hasChangesets)});
    await writeSummary(
      hasChangesets
        ? `## Package release plan\n\n${releases.map(({name, newVersion}) => `- \`${name}@${newVersion}\``).join('\n')}`
        : '## Package release PR\n\nNo unreleased changesets found; the release-PR updater is a no-op.',
    );
    process.stdout.write(`${JSON.stringify({hasChangesets, releases})}\n`);
  } finally {
    await rm(temporaryRoot, {force: true, recursive: true});
  }
}

function releaseFromPullRequest(pullRequest, revision) {
  return {
    authorId: String(pullRequest.user?.id ?? ''),
    baseRevision: pullRequest.base?.sha ?? '',
    headRef: pullRequest.head?.ref ?? '',
    headRepository: pullRequest.head?.repo?.full_name ?? '',
    revision,
  };
}

async function authorize() {
  const eventName = argument('event-name');
  const repository = argument('repository');
  const expectedAppId = argument('release-app-id');
  const revision = argument('revision');
  let release = {
    authorId: argument('author-id') ?? '',
    baseRevision: argument('base') ?? '',
    headRef: argument('head-ref') ?? '',
    headRepository: argument('head-repository') ?? '',
    revision: revision ?? '',
  };

  if (eventName === 'pull_request' && argument('merged') !== 'true') {
    await writeOutput({authorized: 'false'});
    return;
  }
  if (eventName === 'workflow_dispatch' && revision) {
    const result = await run('gh', ['api', `repos/${repository}/commits/${revision}/pulls`]);
    const pullRequest =
      result.code === 0
        ? JSON.parse(result.stdout).find(
            (candidate) => candidate.merged_at !== null && candidate.merge_commit_sha === revision,
          )
        : undefined;
    if (pullRequest) release = releaseFromPullRequest(pullRequest, revision);
  }

  const reason =
    !release.revision ||
    !release.baseRevision ||
    !release.headRepository ||
    !release.headRef ||
    !release.authorId
      ? 'missing-release-metadata'
      : release.headRepository !== repository
        ? 'head-repository-mismatch'
        : release.headRef !== 'changeset-release/main'
          ? 'release-branch-mismatch'
          : release.authorId !== expectedAppId
            ? 'release-app-mismatch'
            : 'authorized';
  const authorized = reason === 'authorized';
  await writeOutput({
    authorized: String(authorized),
    author_id: authorized ? release.authorId : '',
    base_sha: authorized ? release.baseRevision : '',
    head_ref: authorized ? release.headRef : '',
    head_repository: authorized ? release.headRepository : '',
    revision: authorized ? release.revision : '',
  });
  await writeSummary(
    `## Package publication authorization\n\n- Result: **${authorized ? 'authorized' : 'not authorized'}**\n- Reason: \`${reason}\``,
  );
  process.stdout.write(`${JSON.stringify({authorized, reason})}\n`);
}

async function summarizeUpdate() {
  const before = JSON.parse(await readFile(argument('before'), 'utf8'));
  const after = JSON.parse(await readFile(argument('after'), 'utf8'));
  const beforeHead = before[0]?.headRefOid;
  const afterHead = after[0]?.headRefOid;
  const result =
    !beforeHead && afterHead ? 'created' : beforeHead !== afterHead ? 'updated' : 'unchanged';
  const number = after[0]?.number;
  await writeSummary(
    [
      '## Package release PR',
      '',
      `- Trigger: \`${argument('trigger')}\``,
      `- Result: **${result}**`,
      ...(number ? [`- Release PR: #${number}`] : []),
      '- Publication authority: none',
      '- Batching: a newer `main` push cancels pending or running updater work; npm publication uses a separate non-cancelable workflow.',
    ].join('\n'),
  );
  process.stdout.write(`${JSON.stringify({number, result})}\n`);
}

async function summarizePublication() {
  await writeSummary(
    [
      '## npm package publication',
      '',
      `- Trigger: \`${argument('trigger')}\``,
      `- Revision: \`${argument('revision')}\``,
      '- Release tree: deterministically verified before publication.',
      '- Publication: completed; the publisher is serialized and never canceled.',
      '- Recovery: rerun this workflow with `workflow_dispatch` and the same exact merged revision. The closure publisher skips package versions already present in npm.',
    ].join('\n'),
  );
}

const command = process.argv[2];
if (command === 'plan') await plan();
else if (command === 'authorize') await authorize();
else if (command === 'summarize-update') await summarizeUpdate();
else if (command === 'summarize-publication') await summarizePublication();
else throw new Error(`Unknown package release workflow command: ${command ?? '(missing)'}`);
