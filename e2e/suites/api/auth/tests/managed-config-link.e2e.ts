import {randomUUID} from 'node:crypto';
import {
  linkProjectConfigResponseSchema,
  listProjectConfigFilesResponseSchema,
  projectConfigResponseSchema,
} from '@shipfox/api-integration-core-dto';
import {config} from '@shipfox/e2e-core';
import {
  closeTestVcsPullRequest,
  createTestVcsConnection,
  createTestVcsRepository,
  mergeTestVcsPullRequest,
  testVcsExternalRepositoryId,
} from '@shipfox/e2e-setup-integrations';
import {createWorkspace} from '@shipfox/e2e-setup-workspaces';
import type {APIRequestContext} from '@shipfox/playwright';
import {expect, test} from './test.js';

const WORKFLOW_PATH = '.shipfox/workflows/triage.yml';
const WORKFLOW = `name: Triage
triggers:
  manual:
    source: manual
    event: fire
jobs:
  triage:
    steps:
      - run: echo triage
`;

async function arrange(auth: {
  createUser: () => Promise<{user: {id: string}; email: string}>;
  createSession: (body: {user_id: string}) => Promise<{token: string}>;
}) {
  const user = await auth.createUser();
  const workspace = await createWorkspace({userId: user.user.id, userEmail: user.email});
  const session = await auth.createSession({user_id: user.user.id});
  const connection = await createTestVcsConnection({
    workspaceId: workspace.id,
    accountId: `acme-${randomUUID().slice(0, 8)}`,
    displayName: 'Test VCS',
  });
  return {workspace, session, connection, headers: {authorization: `Bearer ${session.token}`}};
}

async function createManagedProject(params: {
  request: APIRequestContext;
  headers: Record<string, string>;
  workspaceId: string;
}): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const response = await params.request.post(`${config.API_URL}/projects`, {
    headers: params.headers,
    data: {
      workspace_id: params.workspaceId,
      name: `Managed ${suffix}`,
      slug: `managed-${suffix}`,
      source: {kind: 'managed', files: [{path: WORKFLOW_PATH, content: WORKFLOW}]},
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

async function createTargetRepository(
  connectionId: string,
  accountId: string,
  files = [{path: 'README.md', content: '# App\n'}],
) {
  const name = `app-${randomUUID().slice(0, 8)}`;
  await createTestVcsRepository({connectionId, name, defaultBranch: 'trunk', files});
  return {name, externalRepositoryId: testVcsExternalRepositoryId(accountId, name)};
}

function link(params: {
  request: APIRequestContext;
  headers: Record<string, string>;
  projectId: string;
  body: Record<string, unknown>;
}) {
  return params.request.post(`${config.API_URL}/projects/${params.projectId}/config/link`, {
    headers: params.headers,
    data: params.body,
  });
}

async function readConfig(params: {
  request: APIRequestContext;
  headers: Record<string, string>;
  projectId: string;
}) {
  const response = await params.request.get(
    `${config.API_URL}/projects/${params.projectId}/config`,
    {
      headers: params.headers,
    },
  );
  expect(response.status()).toBe(200);
  return projectConfigResponseSchema.parse(await response.json());
}

test('moves a managed project to a repository and finishes when its pull request merges', async ({
  request,
  auth,
}) => {
  const {workspace, connection, headers} = await arrange(auth);
  const projectId = await createManagedProject({request, headers, workspaceId: workspace.id});
  const target = await createTargetRepository(connection.id, connection.external_account_id);
  const body = {connection_id: connection.id, external_repository_id: target.externalRepositoryId};

  const before = await readConfig({request, headers, projectId});
  expect(before.source.kind).toBe('managed');
  expect(before.move).toBeNull();

  const dryRun = await link({request, headers, projectId, body: {...body, dry_run: true}});
  expect(dryRun.status()).toBe(200);
  expect(linkProjectConfigResponseSchema.parse(await dryRun.json())).toMatchObject({
    status: 'ready',
    file_count: 1,
    pull_request: null,
  });
  expect((await readConfig({request, headers, projectId})).source.kind).toBe('managed');

  const moved = await link({request, headers, projectId, body});
  expect(moved.status()).toBe(200);
  const result = linkProjectConfigResponseSchema.parse(await moved.json());
  expect(result).toMatchObject({status: 'linked', pull_request: {number: 1, state: 'open'}});

  const open = await readConfig({request, headers, projectId});
  expect(open.source).toMatchObject({
    kind: 'linked',
    provider: 'test-vcs',
    external_repository_id: target.externalRepositoryId,
    name: target.name,
    default_branch: 'trunk',
  });
  expect(open.move).toMatchObject({status: 'linked'});
  expect(open.pull_request).toMatchObject({number: 1, state: 'open'});
  const emptyFiles = await request.get(`${config.API_URL}/projects/${projectId}/config/files`, {
    headers,
  });
  expect(listProjectConfigFilesResponseSchema.parse(await emptyFiles.json()).files).toEqual([]);

  await mergeTestVcsPullRequest({
    connectionId: connection.id,
    externalRepositoryId: target.externalRepositoryId,
    number: 1,
  });

  const merged = await readConfig({request, headers, projectId});
  expect(merged.pull_request).toBeNull();
  const files = await request.get(`${config.API_URL}/projects/${projectId}/config/files`, {
    headers,
  });
  expect(
    listProjectConfigFilesResponseSchema.parse(await files.json()).files.map((file) => file.path),
  ).toEqual([WORKFLOW_PATH]);

  const again = await link({request, headers, projectId, body});
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe('already-moved');
});

test('opens a new pull request after the first one closed', async ({request, auth}) => {
  const {workspace, connection, headers} = await arrange(auth);
  const projectId = await createManagedProject({request, headers, workspaceId: workspace.id});
  const target = await createTargetRepository(connection.id, connection.external_account_id);
  await link({
    request,
    headers,
    projectId,
    body: {connection_id: connection.id, external_repository_id: target.externalRepositoryId},
  });
  const url = `${config.API_URL}/projects/${projectId}/config/link/pull-request`;

  const whileOpen = await request.post(url, {headers});
  expect(whileOpen.status()).toBe(409);
  await closeTestVcsPullRequest({
    connectionId: connection.id,
    externalRepositoryId: target.externalRepositoryId,
    number: 1,
  });
  expect((await readConfig({request, headers, projectId})).pull_request).toMatchObject({
    number: 1,
    state: 'closed',
  });
  const reopened = await request.post(url, {headers});

  expect(reopened.status()).toBe(200);
  expect((await reopened.json()).pull_request).toMatchObject({number: 2, state: 'open'});
  expect((await readConfig({request, headers, projectId})).pull_request).toMatchObject({
    number: 2,
    state: 'open',
  });
});

test('refuses a repository that already has config, or that another project took', async ({
  request,
  auth,
}) => {
  const {workspace, connection, headers} = await arrange(auth);
  const first = await createManagedProject({request, headers, workspaceId: workspace.id});
  const second = await createManagedProject({request, headers, workspaceId: workspace.id});
  const withConfig = await createTargetRepository(connection.id, connection.external_account_id, [
    {path: WORKFLOW_PATH, content: WORKFLOW},
  ]);
  const target = await createTargetRepository(connection.id, connection.external_account_id);
  const body = (repository: {externalRepositoryId: string}) => ({
    connection_id: connection.id,
    external_repository_id: repository.externalRepositoryId,
  });

  const exists = await link({request, headers, projectId: first, body: body(withConfig)});
  expect(exists.status()).toBe(409);
  expect((await exists.json()).code).toBe('config-exists');
  expect((await readConfig({request, headers, projectId: first})).source.kind).toBe('managed');

  expect((await link({request, headers, projectId: first, body: body(target)})).status()).toBe(200);
  const taken = await link({request, headers, projectId: second, body: body(target)});
  expect(taken.status()).toBe(409);
  expect((await taken.json()).code).toBe('repository-in-use');
});

test("lets two projects race for one repository without adopting each other's pull request", async ({
  request,
  auth,
}) => {
  const {workspace, connection, headers} = await arrange(auth);
  const first = await createManagedProject({request, headers, workspaceId: workspace.id});
  const second = await createManagedProject({request, headers, workspaceId: workspace.id});
  const target = await createTargetRepository(connection.id, connection.external_account_id);
  const body = {connection_id: connection.id, external_repository_id: target.externalRepositoryId};

  const [a, b] = await Promise.all([
    link({request, headers, projectId: first, body}),
    link({request, headers, projectId: second, body}),
  ]);

  const statuses = [a.status(), b.status()].sort();
  expect(statuses).toEqual([200, 409]);
  const loser = a.status() === 409 ? a : b;
  expect(['source-already-bound', 'repository-in-use']).toContain((await loser.json()).code);
  const loserId = a.status() === 409 ? first : second;
  const winnerId = loserId === first ? second : first;
  expect((await readConfig({request, headers, projectId: loserId})).source.kind).toBe('managed');
  expect((await readConfig({request, headers, projectId: loserId})).pull_request).toBeNull();
  const winner = await readConfig({request, headers, projectId: winnerId});
  expect(winner.source.kind).toBe('linked');
  expect(winner.pull_request).not.toBeNull();
});
