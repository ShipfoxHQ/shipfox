import {cp, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {startGithubApiMock} from '@shipfox/e2e-driver-github';
import {createSession, createUser} from '@shipfox/e2e-setup-auth';
import {createGithubConnection} from '@shipfox/e2e-setup-integrations';
import {createProject} from '@shipfox/e2e-setup-projects';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';

const SYNC_TIMEOUT_MS = 60_000;

/** Splits `owner/name`, giving a case with no repository one of its own. */
function repositoryName({
  repository,
  uniqueId,
}: {
  repository?: string | undefined;
  uniqueId: string;
}) {
  const [owner, name] = (repository ?? `acme/case-${uniqueId}`).split('/');
  if (!owner || !name) throw new Error(`Repository must be owner/name, received "${repository}".`);
  return {owner, name};
}

async function seedRepository({
  caseDirectory,
  directory,
}: {
  caseDirectory?: string | undefined;
  directory: string;
}): Promise<void> {
  const source = caseDirectory === undefined ? undefined : join(caseDirectory, 'repo');
  const hasRepo =
    source !== undefined &&
    (await stat(source).then(
      (entry) => entry.isDirectory(),
      () => false,
    ));
  if (hasRepo) await cp(source, directory, {recursive: true});
  else await writeFile(join(directory, 'README.md'), '# Case repository\n');
}

// A repository with no workflow files ends its sync as `failed`. Callers create their definitions
// through the API, so only a settled sync matters.
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
      return status === 'failed' || status === 'succeeded' ? response : null;
    },
  );
}

export interface GithubProjectOptions {
  /** Its `repo/` directory, when present, seeds the fake repository. */
  caseDirectory?: string | undefined;
  repository?: string | undefined;
  /** Names the workspace, and keeps the fake installation apart from other runs. */
  label: string;
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}

/**
 * A workspace with an active GitHub connection and a project on a repository the GitHub fake
 * serves, ready for definitions.
 */
export async function arrangeGithubProject(options: GithubProjectOptions) {
  const {cleanups} = options;
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const installationId = Number.parseInt(uniqueId.slice(0, 7), 16) + 1;
  const installationToken = `ghs_${uniqueId}.${'e'.repeat(36)}.${'f'.repeat(36)}`;

  const github = await startGithubApiMock({installationId, installationToken});
  cleanups.push(() => github.stop());

  const seedDirectory = await mkdtemp(join(tmpdir(), 'eval-repository-'));
  cleanups.push(() => rm(seedDirectory, {recursive: true, force: true}));
  await seedRepository({caseDirectory: options.caseDirectory, directory: seedDirectory});
  const {owner, name} = repositoryName({repository: options.repository, uniqueId});
  const repository = await github.addRepository({owner, name, seedDirectory});

  // A GitHub connection resyncs every project of its workspace when it becomes active, so each
  // run gets a workspace of its own.
  const user = await createUser({name: `Eval ${uniqueId}`});
  const workspace = await createWorkspace({
    userId: user.user.id,
    userEmail: user.email,
    name: `Eval ${options.label} ${uniqueId}`,
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

  return {uniqueId, github, repository, workspace, session, client, connection, project};
}
