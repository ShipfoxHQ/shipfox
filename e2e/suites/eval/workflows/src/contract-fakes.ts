import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {createApiClient, RecordedWrite} from '@shipfox/e2e-core';
import type {GithubApiMock} from '@shipfox/e2e-driver-github';
import type {SandboxManifest} from './contract-schema.js';

/** The `fixtures` of one provider in `sandbox.yaml`. */
export type SandboxFixtures = SandboxManifest[string]['fixtures'];

/** A provider fake that the contracts suite has started, with its connection in the workspace. */
export interface ContractFake {
  /** The slug of the workspace's connection to the fake. */
  connectionSlug: string;
  /**
   * Loads the provider's sandbox fixtures into the fake, with the same ids and fields, so a case
   * reads the same objects from the fake that it reads from the sandbox. A fixture the adapter
   * doesn't know is left out, and the cases that read it fail on the fake.
   */
  seed(fixtures: SandboxFixtures): Promise<void>;
  /** Every write the fake accepted. Read before the fake stops. */
  writes(): RecordedWrite[];
}

/** What every adapter starts from: the workspace of the run, and the GitHub fake of its project. */
export interface ContractFakeContext {
  workspaceId: string;
  uniqueId: string;
  github: {mock: GithubApiMock; connectionId: string; connectionSlug: string};
  /** The API client of the run's user, an admin of the workspace. */
  client: ReturnType<typeof createApiClient>;
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}

export type ContractFakeAdapter = (context: ContractFakeContext) => Promise<ContractFake>;

function field({
  fixture,
  name,
}: {
  fixture: SandboxFixtures[string];
  name: string;
}): string | number | boolean | undefined {
  const value = fixture[name];
  return typeof value === 'object' ? undefined : value;
}

function requiredField({
  fixture,
  fixtureName,
  name,
}: {
  fixture: SandboxFixtures[string];
  fixtureName: string;
  name: string;
}) {
  const value = field({fixture, name});
  if (value === undefined) throw new Error(`The github fixture "${fixtureName}" has no "${name}".`);
  return value;
}

/**
 * GitHub, whose fake the run already started for the project. It seeds the `repository` fixture as
 * a repository of the fake, and the `issue` fixture as one of its issues.
 *
 * The sandbox repository is not the project's repository, and a connection only reaches the
 * repositories of its projects until it is set to reach all of them. The sandbox connection is
 * installed on the whole sandbox organization, so the fake's connection reaches all too.
 */
export const githubContractFake: ContractFakeAdapter = ({github, client, cleanups}) => {
  const {mock} = github;
  return Promise.resolve({
    connectionSlug: github.connectionSlug,
    seed: async (fixtures) => {
      const repository = fixtures.repository;
      if (repository === undefined) {
        if (fixtures.issue !== undefined) {
          throw new Error('The github issue fixture needs a repository fixture.');
        }
        return;
      }
      const owner = String(
        requiredField({fixture: repository, fixtureName: 'repository', name: 'owner'}),
      );
      const name = String(
        requiredField({fixture: repository, fixtureName: 'repository', name: 'name'}),
      );
      const seedDirectory = await mkdtemp(join(tmpdir(), 'contracts-repository-'));
      cleanups.push(() => rm(seedDirectory, {recursive: true, force: true}));
      await writeFile(join(seedDirectory, 'README.md'), '# Contracts sandbox\n');
      const added = await mock.addRepository({owner, name, seedDirectory});
      await client.request(
        'put',
        `/integration-connections/${github.connectionId}/repository-access`,
        {
          json: {mode: 'all'},
        },
      );

      const issue = fixtures.issue;
      if (issue === undefined) return;
      const number = Number(requiredField({fixture: issue, fixtureName: 'issue', name: 'number'}));
      const title = field({fixture: issue, name: 'title'});
      const body = field({fixture: issue, name: 'body'});
      const state = field({fixture: issue, name: 'state'});
      mock.issues.set(number, {
        repository: added.fullName,
        title: title === undefined ? `Contract fixture issue ${number}` : String(title),
        ...(body === undefined ? {} : {body: String(body)}),
        ...(state === 'open' || state === 'closed' ? {state} : {}),
      });
    },
    writes: () => mock.writes(),
  });
};

/**
 * The adapter of each provider the suite can run in fake mode. A provider joins when its fake
 * parity unit adds its adapter, and its cases gain `fake` in `modes` in the same change.
 */
export const CONTRACT_FAKE_ADAPTERS: Readonly<Record<string, ContractFakeAdapter>> = {
  github: githubContractFake,
};
