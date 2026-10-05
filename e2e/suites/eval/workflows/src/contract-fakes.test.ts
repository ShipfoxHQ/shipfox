import type {createApiClient} from '@shipfox/e2e-core';
import {type GithubApiMock, startGithubApiMock} from '@shipfox/e2e-driver-github';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {
  CONTRACT_FAKE_ADAPTERS,
  githubContractFake,
  type SandboxFixtures,
} from './contract-fakes.js';

type ApiClient = ReturnType<typeof createApiClient>;

const token = `ghs_${'a'.repeat(40)}`;
const missingRepositoryPattern = /issue fixture needs a repository fixture/u;
const missingOwnerPattern = /fixture "repository" has no "owner"/u;

describe('githubContractFake', () => {
  let mock: GithubApiMock | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  const requests: Array<{method: string; path: string; options: unknown}> = [];

  afterEach(async () => {
    requests.length = 0;
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    await mock?.stop();
    mock = undefined;
  });

  async function arrange() {
    mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationToken: token,
    });
    return await githubContractFake({
      workspaceId: 'workspace',
      uniqueId: 'unique',
      github: {mock, connectionId: 'connection-1', connectionSlug: 'github_fake'},
      client: {
        request: (method: string, path: string, options: unknown) => {
          requests.push({method, path, options});
          return Promise.resolve();
        },
      } as unknown as ApiClient,
      cleanups,
    });
  }

  async function readIssue(number: number) {
    const response = await fetch(
      new URL(`/repos/contracts-sandbox/fixtures/issues/${number}`, mock?.endpoint),
      {headers: {authorization: `token ${token}`}},
    );
    return {status: response.status, body: (await response.json()) as Record<string, unknown>};
  }

  it('serves the fixture issue from the fixture repository, with the same number and fields', async () => {
    const fake = await arrange();
    const fixtures: SandboxFixtures = {
      repository: {owner: 'contracts-sandbox', name: 'fixtures'},
      issue: {number: 7, title: 'Read fixture', body: 'Body', state: 'closed'},
    };

    await fake.seed(fixtures);

    expect(fake.connectionSlug).toBe('github_fake');
    // The sandbox repository is not the project's, so the connection has to reach all repositories.
    expect(requests).toEqual([
      {
        method: 'put',
        path: '/integration-connections/connection-1/repository-access',
        options: {json: {mode: 'all'}},
      },
    ]);
    expect(await readIssue(7)).toMatchObject({
      status: 200,
      body: {number: 7, title: 'Read fixture', body: 'Body', state: 'closed'},
    });
  });

  it('seeds only the issues the sandbox has', async () => {
    const fake = await arrange();

    await fake.seed({repository: {owner: 'contracts-sandbox', name: 'fixtures'}});

    expect(mock?.issues.size).toBe(0);
  });

  it('seeds nothing for a manifest without GitHub fixtures', async () => {
    const fake = await arrange();

    await fake.seed({});

    expect(mock?.issues.size).toBe(0);
  });

  it('rejects an issue without a repository, and a repository without an owner', async () => {
    const fake = await arrange();

    await expect(fake.seed({issue: {number: 1}})).rejects.toThrow(missingRepositoryPattern);
    await expect(fake.seed({repository: {name: 'fixtures'}})).rejects.toThrow(missingOwnerPattern);
  });

  it('is the adapter of the github provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.github).toBe(githubContractFake);
  });
});
