import {createManagedRepository} from '#core/create-repository.js';
import {
  beginManagedLink,
  clearManagedLinkPullRequest,
  completeManagedLink,
  getManagedRepositoryByProject,
  recordManagedLinkPullRequest,
  releaseManagedLink,
  replaceManagedLinkPullRequest,
} from './repositories.js';

async function setup() {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  await createManagedRepository({workspaceId, projectId});
  const repository = await getManagedRepositoryByProject({workspaceId, projectId});
  if (!repository) throw new Error('The repository was not created');
  return {workspaceId, projectId, repositoryId: repository.id};
}

function target() {
  return {
    attemptId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    externalRepositoryId: 'github:42',
    startedBy: 'user-1',
  };
}

describe('managed repository link state', () => {
  it('starts active with no link', async () => {
    const {workspaceId, projectId} = await setup();

    const repository = await getManagedRepositoryByProject({workspaceId, projectId});

    expect(repository).toMatchObject({status: 'active', link: null, pullRequest: null});
  });

  it('only finds a repository inside its workspace', async () => {
    const {projectId} = await setup();

    const repository = await getManagedRepositoryByProject({
      workspaceId: crypto.randomUUID(),
      projectId,
    });

    expect(repository).toBeUndefined();
  });

  it('begins a move with the target and the actor', async () => {
    const {repositoryId} = await setup();
    const input = target();

    const result = await beginManagedLink({repositoryId, ...input});

    expect(result).toMatchObject({
      kind: 'started',
      repository: {
        status: 'linking',
        link: {
          attemptId: input.attemptId,
          connectionId: input.connectionId,
          externalRepositoryId: 'github:42',
          startedBy: 'user-1',
        },
      },
    });
    expect(result?.repository.link?.startedAt).toBeInstanceOf(Date);
  });

  it('resumes with the stored attempt and only restarts the clock', async () => {
    const {repositoryId} = await setup();
    const first = target();
    await beginManagedLink({repositoryId, ...first, now: new Date('2026-01-01T00:00:00Z')});

    const resumed = await beginManagedLink({
      repositoryId,
      ...target(),
      now: new Date('2026-01-01T00:05:00Z'),
    });

    expect(resumed).toMatchObject({
      kind: 'resumed',
      repository: {
        link: {
          attemptId: first.attemptId,
          connectionId: first.connectionId,
          externalRepositoryId: 'github:42',
          startedBy: 'user-1',
        },
      },
    });
    expect(resumed?.repository.link?.startedAt).toEqual(new Date('2026-01-01T00:05:00Z'));
  });

  it('refuses to begin again once linked', async () => {
    const {repositoryId} = await setup();
    const input = target();
    await beginManagedLink({repositoryId, ...input});
    await completeManagedLink({repositoryId, attemptId: input.attemptId});

    const result = await beginManagedLink({repositoryId, ...target()});

    expect(result?.kind).toBe('linked');
  });

  it('records the pull request only for the stored attempt', async () => {
    const {workspaceId, projectId, repositoryId} = await setup();
    const input = target();
    await beginManagedLink({repositoryId, ...input});

    const stale = await recordManagedLinkPullRequest({
      repositoryId,
      attemptId: crypto.randomUUID(),
      url: 'https://github.com/acme/app/pull/1',
      number: 1,
    });
    const recorded = await recordManagedLinkPullRequest({
      repositoryId,
      attemptId: input.attemptId,
      url: 'https://github.com/acme/app/pull/2',
      number: 2,
    });

    expect(stale).toBe(false);
    expect(recorded).toBe(true);
    const repository = await getManagedRepositoryByProject({workspaceId, projectId});
    expect(repository?.pullRequest).toEqual({url: 'https://github.com/acme/app/pull/2', number: 2});
  });

  it('releases a refused move back to active', async () => {
    const {workspaceId, projectId, repositoryId} = await setup();
    const input = target();
    await beginManagedLink({repositoryId, ...input});
    await recordManagedLinkPullRequest({
      repositoryId,
      attemptId: input.attemptId,
      url: 'https://github.com/acme/app/pull/2',
      number: 2,
    });

    const released = await releaseManagedLink({repositoryId, attemptId: input.attemptId});

    expect(released).toBe(true);
    expect(await getManagedRepositoryByProject({workspaceId, projectId})).toMatchObject({
      status: 'active',
      link: null,
      pullRequest: null,
    });
  });

  it('never releases a linked repository', async () => {
    const {workspaceId, projectId, repositoryId} = await setup();
    const input = target();
    await beginManagedLink({repositoryId, ...input});
    await completeManagedLink({repositoryId, attemptId: input.attemptId});

    const released = await releaseManagedLink({repositoryId, attemptId: input.attemptId});

    expect(released).toBe(false);
    expect((await getManagedRepositoryByProject({workspaceId, projectId}))?.status).toBe('linked');
  });

  it('swaps a closed pull request for a new attempt only once', async () => {
    const {workspaceId, projectId, repositoryId} = await setup();
    const input = target();
    await beginManagedLink({repositoryId, ...input});
    await completeManagedLink({repositoryId, attemptId: input.attemptId});
    const attemptId = crypto.randomUUID();

    const first = await replaceManagedLinkPullRequest({
      repositoryId,
      expectedAttemptId: input.attemptId,
      attemptId,
      url: 'https://github.com/acme/app/pull/3',
      number: 3,
    });
    const second = await replaceManagedLinkPullRequest({
      repositoryId,
      expectedAttemptId: input.attemptId,
      attemptId: crypto.randomUUID(),
      url: 'https://github.com/acme/app/pull/4',
      number: 4,
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    const repository = await getManagedRepositoryByProject({workspaceId, projectId});
    expect(repository?.link?.attemptId).toBe(attemptId);
    expect(repository?.pullRequest?.number).toBe(3);
  });

  it('clears the pull request by number', async () => {
    const {workspaceId, projectId, repositoryId} = await setup();
    const input = target();
    await beginManagedLink({repositoryId, ...input});
    await recordManagedLinkPullRequest({
      repositoryId,
      attemptId: input.attemptId,
      url: 'https://github.com/acme/app/pull/2',
      number: 2,
    });

    await clearManagedLinkPullRequest({repositoryId, number: 9});
    expect((await getManagedRepositoryByProject({workspaceId, projectId}))?.pullRequest).not.toBe(
      null,
    );
    await clearManagedLinkPullRequest({repositoryId, number: 2});

    expect((await getManagedRepositoryByProject({workspaceId, projectId}))?.pullRequest).toBeNull();
  });
});
