import {randomUUID} from 'node:crypto';
import {VALUES_ONLY_TOOLS} from './contract-generator.js';
import {
  type ContractReferenceResolver,
  resolveContractReferences,
  resolveManifestValue,
} from './contract-references.js';
import type {ContractRead, SandboxManifest} from './contract-schema.js';
import type {LoadedContractCase} from './contracts.js';
import {failedChecks, valueAt} from './expectations.js';
import type {ContractGateway, ContractToolOutcome} from './gateway.js';

const MAX_RESULT_CHARACTERS = 1_500;

/**
 * Runs a case's steps in order through the gateway, each `effect` right after its write, and
 * throws on the first step that fails, as its job would. A step fails when the call fails, or
 * when its result misses a check. A step that expects an error fails unless the call fails with
 * that code.
 */
export async function runContractCase({
  loaded,
  manifest,
  gateway,
}: {
  loaded: LoadedContractCase;
  manifest: SandboxManifest;
  gateway: ContractGateway;
}): Promise<void> {
  const {definition} = loaded;
  const results = new Map<string, unknown>();
  const run = {marker: `contract-${randomUUID()}`, createdAt: Math.floor(Date.now() / 1000)};
  for (const [index, step] of definition.steps.entries()) {
    const label = step.key ?? `steps[${index}]`;
    const result = await runRead({
      label,
      read: step,
      provider: definition.provider,
      resolver: caseResolver({manifest, results, run}),
      gateway,
    });
    if (step.key !== undefined) results.set(step.key, result);
    if (step.effect === undefined) continue;
    // A fake applies a write before it answers, so the effect reads at once.
    await runRead({
      label: `${label} effect`,
      read: step.effect,
      provider: definition.provider,
      resolver: caseResolver({manifest, results, run}),
      gateway,
    });
  }
}

async function runRead({
  label,
  read,
  provider,
  resolver,
  gateway,
}: {
  label: string;
  read: ContractRead & {expect: {error?: string | undefined}};
  provider: string;
  resolver: ContractReferenceResolver;
  gateway: ContractGateway;
}): Promise<unknown> {
  const tool = read.method === undefined ? read.tool : `${read.tool}.${read.method}`;
  const withValue = resolveContractReferences(read.with, resolver) as Record<string, unknown>;
  const expect = resolveContractReferences(read.expect, resolver) as ContractRead['expect'] & {
    error?: string | undefined;
  };
  const outcome = await gateway.call({
    provider,
    tool: read.tool,
    method: read.method,
    with: withValue,
  });
  const failure = (reason: string) =>
    new Error(`Step "${label}" (${tool}) ${reason}\nwith: ${truncate(withValue)}`);

  if (expect.error !== undefined) {
    if (outcome.outcome === 'error' && outcome.code === expect.error) return undefined;
    throw failure(`should fail with "${expect.error}" but ${describeOutcome(outcome)}.`);
  }
  if (outcome.outcome === 'error') {
    throw failure(`failed with "${outcome.code}": ${outcome.message}`);
  }
  const failures = failedChecks({
    expect,
    result: outcome.result,
    valuesOnly: VALUES_ONLY_TOOLS.has(`${provider}.${read.tool}`),
  });
  if (failures.length > 0) {
    throw failure(
      `missed checks:\n- ${failures.join('\n- ')}\nresult: ${truncate(outcome.result)}`,
    );
  }
  return outcome.result;
}

/**
 * Resolves references as the generated workflow does at run time. `$steps` reads an earlier
 * step's result, and an absent value becomes `""`, or `0` for `$steps_number`.
 */
function caseResolver({
  manifest,
  results,
  run,
}: {
  manifest: SandboxManifest;
  results: ReadonlyMap<string, unknown>;
  run: {marker: string; createdAt: number};
}): ContractReferenceResolver {
  const fromManifest: ContractReferenceResolver['fixture'] = (reference) => {
    const value = resolveManifestValue({manifest, reference});
    if (value === undefined)
      throw new Error(`${reference.kind} ${reference.name} is not in sandbox.yaml`);
    return value;
  };
  return {
    fixture: fromManifest,
    target: fromManifest,
    steps: ({key, path, text = false, number = false}) => {
      const value = valueAt(results.get(key), path);
      if (value === undefined) return number ? 0 : '';
      if (text) return typeof value === 'string' ? value : JSON.stringify(value);
      return value;
    },
    marker: () => run.marker,
    inOneHour: () => run.createdAt + 3600,
  };
}

function describeOutcome(outcome: ContractToolOutcome): string {
  return outcome.outcome === 'error'
    ? `it failed with "${outcome.code}": ${outcome.message}`
    : `it succeeded with ${truncate(outcome.result)}`;
}

function truncate(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > MAX_RESULT_CHARACTERS ? `${text.slice(0, MAX_RESULT_CHARACTERS)}...` : text;
}
