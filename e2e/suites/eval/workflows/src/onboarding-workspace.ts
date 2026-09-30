import {execFile} from 'node:child_process';
import {cp, mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative} from 'node:path';
import {promisify} from 'node:util';
import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {startGithubApiMock} from '@shipfox/e2e-driver-github';
import {startLinearMcpMock} from '@shipfox/e2e-driver-linear';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection, createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import type {McpProxy, McpProxySession} from './mcp-proxy.js';
import type {OnboardingCase} from './onboarding-schema.js';

const run = promisify(execFile);
const SYNC_TIMEOUT_MS = 60_000;
const WORKFLOWS_DIRECTORY = '.shipfox/workflows';
// The developer's own git configuration must not decide whether the fixture commit is signed.
const GIT_COMMIT_CONFIG = [
  '-c',
  'user.name=Eval',
  '-c',
  'user.email=eval@example.test',
  '-c',
  'commit.gpgsign=false',
];

export interface OnboardingWorkspace {
  /** The temporary repository the agent works in, with `origin` set to the fixture repository. */
  cwd: string;
  workspaceId: string;
  projectId: string;
  proxySession: McpProxySession;
}

export interface ArrangeOnboardingWorkspaceOptions {
  templateCase: OnboardingCase;
  caseDirectory: string;
  proxy: McpProxy;
  /** Cleanups run in reverse, by the caller, however the case ends. */
  cleanups: Array<() => Promise<void>>;
}

async function seedRepository({
  caseDirectory,
  directory,
}: {
  caseDirectory: string;
  directory: string;
}): Promise<void> {
  const source = join(caseDirectory, 'repo');
  const hasRepo = await stat(source).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  if (hasRepo) await cp(source, directory, {recursive: true});
  else await writeFile(join(directory, 'README.md'), '# Case repository\n');
}

/** The agent's checkout: the fixture files, committed, with the fake as `origin`. */
async function createCheckout({
  caseDirectory,
  originUrl,
  cleanups,
}: {
  caseDirectory: string;
  originUrl: string;
  cleanups: Array<() => Promise<void>>;
}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'eval-onboarding-'));
  cleanups.push(() => rm(cwd, {recursive: true, force: true}));
  await seedRepository({caseDirectory, directory: cwd});
  await run('git', ['init', '--initial-branch=main', cwd]);
  await run('git', ['-C', cwd, 'remote', 'add', 'origin', originUrl]);
  await run('git', ['-C', cwd, 'add', '--all']);
  await run('git', ['-C', cwd, ...GIT_COMMIT_CONFIG, 'commit', '--message', 'Initial commit']);
  return cwd;
}

async function waitForProjectSync({
  projectId,
  token,
}: {
  projectId: string;
  token: string;
}): Promise<void> {
  const client = createApiClient({token});
  let status = 'unknown';
  await pollUntil(
    {
      timeoutMs: SYNC_TIMEOUT_MS,
      intervalMs: 250,
      maxIntervalMs: 1_000,
      describe: () => `definition sync of project ${projectId}: status=${status}`,
    },
    async () => {
      const response = await client.requestJson<DefinitionListResponseDto>(
        'get',
        `/definitions?${new URLSearchParams({project_id: projectId, limit: '100'})}`,
      );
      status = response.sync?.status ?? 'null';
      // The fixture has no workflow files, so that failure is the expected way to finish.
      const finished =
        status === 'succeeded' ||
        (status === 'failed' && response.sync?.last_error_code === 'no-workflow-files');
      return finished ? response : null;
    },
  );
}

/**
 * Sets up what a real user has before they paste the prompt: a workspace with the connections
 * the case lists, a project on the fixture repository, a checkout of it, and an agent-access
 * grant behind the recording proxy.
 */
export async function arrangeOnboardingWorkspace(
  options: ArrangeOnboardingWorkspaceOptions,
): Promise<OnboardingWorkspace> {
  const {templateCase, caseDirectory, proxy, cleanups} = options;
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const [owner = '', name = ''] = templateCase.workspace.project.repository.split('/');

  const github = await startGithubApiMock({
    installationId,
    installationToken: `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`,
  });
  cleanups.push(() => github.stop());
  const seedDirectory = await mkdtemp(join(tmpdir(), 'eval-repository-'));
  cleanups.push(() => rm(seedDirectory, {recursive: true, force: true}));
  await seedRepository({caseDirectory, directory: seedDirectory});
  const repository = await github.addRepository({owner, name, seedDirectory});

  // A GitHub connection resyncs every project of its workspace when it becomes active, so each
  // case gets a workspace of its own.
  const user = await createUser({name: `Eval ${uniqueId}`});
  const workspace = await createWorkspace({
    userId: user.user.id,
    userEmail: user.email,
    name: `Eval onboarding ${uniqueId}`,
  });
  const session = await createSession({user_id: user.user.id});
  const client = createApiClient({token: session.token});

  const connection = await createGithubConnection({
    workspaceId: workspace.id,
    installationId,
    accountLogin: repository.owner,
    displayName: `Eval ${uniqueId}`,
    installerUserId: crypto.randomUUID(),
    lifecycleStatus: 'disabled',
  });
  await client.request('patch', `/integration-connections/${connection.id}`, {
    json: {lifecycle_status: 'active'},
  });
  const project = await createProject({
    workspaceId: workspace.id,
    name: `Eval ${uniqueId}`,
    sourceConnectionId: connection.id,
    sourceExternalRepositoryId: `github:${repository.id}`,
    sourceRepositoryOwner: repository.owner,
    sourceRepositoryName: repository.name,
    sourceDefaultBranch: repository.defaultBranch,
  });
  await waitForProjectSync({projectId: project.id, token: session.token});

  if (templateCase.workspace.connections.includes('linear')) {
    const linear = await startLinearMcpMock();
    cleanups.push(() => linear.stop());
    await createLinearConnection({
      workspaceId: workspace.id,
      organizationId: `eval-org-${uniqueId}`,
      organizationUrlKey: `eval-${uniqueId}`,
      appUserId: `eval-app-${uniqueId}`,
      displayName: `Eval ${uniqueId}`,
      accessToken: `lin_oauth_${uniqueId}`,
    });
  }

  const cwd = await createCheckout({
    caseDirectory,
    originUrl: `${github.endpoint.origin}/github.com/${repository.fullName}.git`,
    cleanups,
  });
  const proxySession = await proxy.openSession({
    sessionToken: session.token,
    workspaceId: workspace.id,
  });
  cleanups.push(async () => proxySession.close());

  return {cwd, workspaceId: workspace.id, projectId: project.id, proxySession};
}

export interface WrittenFile {
  /** Relative to the checkout. */
  path: string;
  content: string;
}

/** The files the agent wrote under `.shipfox/workflows/`, which the graders check. */
export async function collectWorkflowFiles(cwd: string): Promise<WrittenFile[]> {
  const root = join(cwd, WORKFLOWS_DIRECTORY);
  const entries = await readdir(root, {recursive: true, withFileTypes: true}).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  const files: WrittenFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.push({path: relative(cwd, path), content: await readFile(path, 'utf8')});
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}
