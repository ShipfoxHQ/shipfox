import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {
  type SourceControlContractHarness,
  sourceControlContractCases,
} from '@shipfox/api-integration-spi/testing';
import {
  createTestVcsFixture,
  TEST_VCS_PROVIDER,
  TestVcsSourceControlProvider,
} from '#providers/test-vcs.js';

type TestVcsConnection = IntegrationConnection<typeof TEST_VCS_PROVIDER>;

function connection(externalAccountId: string): TestVcsConnection {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: TEST_VCS_PROVIDER,
    externalAccountId,
    slug: 'test_vcs_contract',
    displayName: 'Test VCS',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('TestVcsSourceControlProvider contract', () => {
  const fixture = createTestVcsFixture({port: 0});
  const provider = new TestVcsSourceControlProvider({fixture, credentialTtlSeconds: 60});
  let sequence = 0;

  const harness: SourceControlContractHarness<TestVcsConnection> = {
    provider,
    async createRepository(commits) {
      sequence += 1;
      const owner = connection(`contract-owner-${sequence}`);
      const [first, ...rest] = commits;
      const repository = await provider.createRepository({
        connection: owner,
        name: 'repository',
        files: first ?? [],
      });
      const ids = [
        (
          await provider.resolveRef({
            connection: owner,
            externalRepositoryId: repository.externalRepositoryId,
            ref: 'refs/heads/main',
          })
        ).commit,
      ];
      for (const [index, files] of rest.entries()) {
        ids.push(
          await provider.commitFiles({
            connection: owner,
            externalRepositoryId: repository.externalRepositoryId,
            message: `Commit ${index + 1}`,
            files,
          }),
        );
      }
      return {
        connection: owner,
        foreignConnection: connection('contract-foreign-owner'),
        externalRepositoryId: repository.externalRepositoryId,
        commits: ids,
      };
    },
  };

  beforeAll(async () => {
    await fixture.start();
  });

  afterAll(async () => {
    await fixture.close();
  });

  it.each(sourceControlContractCases)('$name', async ({run}) => {
    await run(harness);
  });
});
