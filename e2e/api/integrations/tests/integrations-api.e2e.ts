import {randomUUID} from 'node:crypto';
import {INTEGRATION_REPOSITORY_PUSHED} from '@shipfox/api-integration-core-dto';
import {expect, test} from './test.js';

test('signed push writes an INTEGRATION_REPOSITORY_PUSHED outbox row visible via /__e2e/integration/events', async ({
  auth,
  workspaces,
  integrationGithub,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  const github = await integrationGithub.connect({workspaceId: workspace.id});

  const push = await integrationGithub.sendSignedPush({installationId: github.installationId});

  expect(push.status).toBe(204);
  const {events} = await integrationGithub.readEvents({deliveryId: push.deliveryId});
  expect(events).toHaveLength(1);
  expect(events[0]?.event_type).toBe(INTEGRATION_REPOSITORY_PUSHED);
  expect(events[0]?.payload).toMatchObject({
    provider: 'github',
    deliveryId: push.deliveryId,
    headCommitSha: push.headCommitSha,
    ref: 'main',
    isDefaultBranch: true,
    externalRepositoryId: `github:${push.repositoryId}`,
  });
});

test('rejects an invalid signature with 401 and writes no outbox row', async ({
  auth,
  workspaces,
  integrationGithub,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  const github = await integrationGithub.connect({workspaceId: workspace.id});
  const deliveryId = randomUUID();

  const push = await integrationGithub.sendRawSignedPush({
    rawBody: JSON.stringify({
      ref: 'refs/heads/main',
      after: 'abc',
      repository: {id: 1, default_branch: 'main'},
      installation: {id: Number(github.installationId)},
    }),
    deliveryId,
    repositoryId: 1,
    headCommitSha: 'abc',
    signature: 'sha256=deadbeef',
  });

  expect(push.status).toBe(401);
  const {events} = await integrationGithub.readEvents({deliveryId});
  expect(events).toEqual([]);
});

test('deduplicates a repeated x-github-delivery to a single outbox row', async ({
  auth,
  workspaces,
  integrationGithub,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  const github = await integrationGithub.connect({workspaceId: workspace.id});
  const deliveryId = randomUUID();

  const first = await integrationGithub.sendSignedPush({
    installationId: github.installationId,
    deliveryId,
  });
  const second = await integrationGithub.sendSignedPush({
    installationId: github.installationId,
    deliveryId,
  });

  expect(first.status).toBe(204);
  expect(second.status).toBe(204);
  const {events} = await integrationGithub.readEvents({deliveryId});
  expect(events).toHaveLength(1);
});

test('non-push events return 204 and write no INTEGRATION_REPOSITORY_PUSHED outbox row', async ({
  auth,
  workspaces,
  integrationGithub,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id});
  await integrationGithub.connect({workspaceId: workspace.id});
  const deliveryId = randomUUID();
  const rawBody = JSON.stringify({zen: 'Practicality beats purity.'});

  const push = await integrationGithub.sendRawSignedPush({
    rawBody,
    deliveryId,
    repositoryId: 0,
    headCommitSha: '',
    eventHeader: 'ping',
  });

  expect(push.status).toBe(204);
  const {events} = await integrationGithub.readEvents({deliveryId});
  expect(events).toEqual([]);
});
