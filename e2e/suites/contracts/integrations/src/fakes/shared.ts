import type {RecordedWrite} from '@shipfox/e2e-core';
import type {SandboxManifest} from '../contract-schema.js';

/** The `fixtures` of one provider in `sandbox.yaml`. */
export type SandboxFixtures = SandboxManifest[string]['fixtures'];

/** The `targets` of one provider in `sandbox.yaml`. */
export type SandboxTargets = SandboxManifest[string]['targets'];

/**
 * A provider fake started in this process. The provider's package reads `env` when it is imported,
 * so the suite sets it before it loads the gateway. `access` is what the provider's tool adapter
 * needs to call the fake as the connection.
 */
export interface ContractFake<Access = unknown> {
  env: Readonly<Record<string, string>>;
  access: Access;
  /**
   * Loads the provider's sandbox fixtures into the fake, with the same ids and fields, so a case
   * reads the same objects from the fake that it reads from the sandbox. A fixture the adapter
   * doesn't know is left out, and the cases that read it fail on the fake.
   */
  seed(fixtures: SandboxFixtures): Promise<void>;
  /**
   * Puts the provider's `inaccessible` targets on the fake's deny list, so it answers them with
   * the status and body the provider returned. An `absent` target is never seeded, so the fake
   * answers it like any unknown id and needs nothing here. A fake without the method has no
   * `inaccessible` target.
   */
  deny?(targets: SandboxTargets): void;
  /** Every write the fake accepted. Read before the fake stops. */
  writes(): RecordedWrite[];
}

export interface ContractFakeContext {
  /** Unique to the run, for tokens and ids the fake must not share with another run. */
  uniqueId: string;
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}

export type ContractFakeAdapter<Access = unknown> = (
  context: ContractFakeContext,
) => Promise<ContractFake<Access>>;

/** An address for a fake to listen on, with a port the system picks. */
export function ephemeralEndpoint(): URL {
  return new URL('http://127.0.0.1:0');
}

export function field({
  fixture,
  name,
}: {
  fixture: SandboxFixtures[string];
  name: string;
}): string | number | boolean | undefined {
  const value = fixture[name];
  return typeof value === 'object' ? undefined : value;
}

export function requiredField({
  provider = 'github',
  fixture,
  fixtureName,
  name,
}: {
  provider?: string;
  fixture: SandboxFixtures[string];
  fixtureName: string;
  name: string;
}) {
  const value = field({fixture, name});
  if (value === undefined) {
    throw new Error(`The ${provider} fixture "${fixtureName}" has no "${name}".`);
  }
  return value;
}

/** The targets that exist outside the connection's reach, which a fake must refuse. */
export function inaccessibleTargets(targets: SandboxTargets): Array<SandboxTargets[string]> {
  return Object.values(targets).filter((target) => target.kind === 'inaccessible');
}

/** Runs a seeding that needs no await, and fails the returned promise instead of throwing. */
export function rejectingSeed(seed: () => void): Promise<void> {
  return new Promise((resolve) => {
    seed();
    resolve();
  });
}

/** Comments for a fixture whose sandbox object holds `count` of them. */
export function fixtureComments(
  fixture: SandboxFixtures[string],
): Array<{id: string; text: string}> {
  const count = Number(field({fixture, name: 'comment_count'}) ?? 0);
  return Array.from({length: count}, (_, index) => ({
    id: `contract-comment-${index + 1}`,
    text: `Contract comment ${index + 1}`,
  }));
}
