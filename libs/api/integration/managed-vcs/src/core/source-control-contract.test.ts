import {
  type SourceControlContractHarness,
  sourceControlContractCases,
} from '@shipfox/api-integration-spi/testing';
import {ManagedSourceControlProvider} from '#core/source-control.js';
import {
  createRepositoryRow,
  type ManagedConnection,
  managedConnection,
  seedCommits,
} from '#test/fixtures/repository.js';

const harness: SourceControlContractHarness<ManagedConnection> = {
  provider: new ManagedSourceControlProvider(),
  async createRepository(commits) {
    const repository = await createRepositoryRow();
    return {
      connection: repository.connection,
      foreignConnection: managedConnection(crypto.randomUUID()),
      externalRepositoryId: repository.externalRepositoryId,
      commits: await seedCommits({
        repositoryId: repository.id,
        commits: commits.map((files) => ({files})),
      }),
    };
  },
};

describe('ManagedSourceControlProvider contract', () => {
  it.each(sourceControlContractCases)('$name', async ({run}) => {
    await run(harness);
  });
});
