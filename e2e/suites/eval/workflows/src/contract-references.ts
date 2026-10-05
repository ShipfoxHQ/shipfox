import type {ContractCase, ContractScalar, SandboxManifest} from './contract-schema.js';

export interface ManifestReference {
  kind: 'fixture' | 'target';
  provider: string;
  name: string;
  field: string;
}

export interface StepsReference {
  kind: 'steps';
  key: string;
  path: string;
}

export interface MarkerReference {
  kind: 'marker';
}

export type ContractReference = ManifestReference | StepsReference | MarkerReference;

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';
// A `$` and the dotted path after it, so `$markers` is one unknown token and not `$marker` plus `s`.
const TOKEN = new RegExp(
  `\\$${IDENTIFIER}(?:\\.${IDENTIFIER}(?:\\[\\d+\\])*)*(?:\\[\\d+\\])*`,
  'gu',
);
const WHOLE_TOKEN = new RegExp(`^${TOKEN.source}$`, 'u');
const NAME = /^[a-z][a-z0-9_]*$/u;
const FIELD = new RegExp(`^${IDENTIFIER}$`, 'u');

/** Reads one token such as `$fixture.linear.issue.uuid`. Returns undefined for an unknown form. */
export function parseContractReference(token: string): ContractReference | undefined {
  const [head = '', ...rest] = token.slice(1).split('.');
  if (head === 'marker') return rest.length === 0 ? {kind: 'marker'} : undefined;
  if (head === 'fixture' || head === 'target') {
    const [provider, name, field, ...extra] = rest;
    if (provider === undefined || name === undefined || field === undefined) return undefined;
    if (extra.length > 0 || !NAME.test(provider) || !NAME.test(name) || !FIELD.test(field)) {
      return undefined;
    }
    return {kind: head, provider, name, field};
  }
  if (head === 'steps') {
    const [key, ...path] = rest;
    if (key === undefined || !NAME.test(key) || path.length === 0) return undefined;
    return {kind: 'steps', key, path: path.join('.')};
  }
  return undefined;
}

export interface FoundReference {
  /** Where the string sits in the value, such as `with.id`. */
  path: string;
  token: string;
  /** Undefined when the token is not one of the four reference forms. */
  reference: ContractReference | undefined;
}

/** Finds every `$...` token in the strings of a value, with the path of its string. */
export function findContractReferences(value: unknown, path = ''): FoundReference[] {
  if (typeof value === 'string') {
    return [...value.matchAll(TOKEN)].map(([token]) => ({
      path,
      token,
      reference: parseContractReference(token),
    }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findContractReferences(item, `${path}[${index}]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      findContractReferences(item, path === '' ? key : `${path}.${key}`),
    );
  }
  return [];
}

export interface ContractReferenceResolver {
  fixture: (reference: ManifestReference) => unknown;
  target: (reference: ManifestReference) => unknown;
  steps: (reference: StepsReference) => unknown;
  marker: () => unknown;
}

function resolveReference({
  reference,
  resolver,
}: {
  reference: ContractReference;
  resolver: ContractReferenceResolver;
}): unknown {
  switch (reference.kind) {
    case 'fixture':
      return resolver.fixture(reference);
    case 'target':
      return resolver.target(reference);
    case 'steps':
      return resolver.steps(reference);
    case 'marker':
      return resolver.marker();
  }
}

function resolveToken({token, resolver}: {token: string; resolver: ContractReferenceResolver}) {
  const reference = parseContractReference(token);
  if (reference === undefined) throw new Error(`unknown reference ${token}`);
  return resolveReference({reference, resolver});
}

/**
 * Replaces the references in the strings of a value. A string that is only a reference becomes
 * what the resolver returns, so a numeric fixture stays a number. A reference inside longer text,
 * as in `Contract $marker`, becomes its text. Object keys are not resolved.
 */
export function resolveContractReferences(
  value: unknown,
  resolver: ContractReferenceResolver,
): unknown {
  if (typeof value === 'string') {
    if (WHOLE_TOKEN.test(value)) return resolveToken({token: value, resolver});
    return value.replace(TOKEN, (token) => String(resolveToken({token, resolver})));
  }
  if (Array.isArray(value)) return value.map((item) => resolveContractReferences(item, resolver));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveContractReferences(item, resolver)]),
    );
  }
  return value;
}

export function resolveManifestValue({
  manifest,
  reference,
}: {
  manifest: SandboxManifest;
  reference: ManifestReference;
}): ContractScalar | undefined {
  const provider = manifest[reference.provider];
  const group = reference.kind === 'fixture' ? provider?.fixtures : provider?.targets;
  const value = group?.[reference.name]?.[reference.field];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined;
}

/**
 * Reports the references of a case that cannot be resolved: an unknown form, a fixture or target
 * the manifest lacks, a target outside an error case, and a `$steps` reference to a key that is
 * missing or runs later. A step's `effect` may read the step it checks.
 */
export function checkCaseReferences({
  contractCase,
  manifest,
}: {
  contractCase: ContractCase;
  manifest: SandboxManifest;
}): string[] {
  const problems: string[] = [];
  const keyIndex = new Map<string, number>();
  contractCase.steps.forEach((step, index) => {
    if (step.key !== undefined) keyIndex.set(step.key, index);
  });

  contractCase.steps.forEach((step, index) => {
    const parts = [
      {name: 'with', value: step.with, lastStep: index - 1},
      {name: 'expect', value: step.expect, lastStep: index - 1},
      {name: 'effect', value: step.effect, lastStep: index},
    ];
    for (const part of parts) {
      for (const found of findContractReferences(part.value)) {
        const where = `steps.${index}.${part.name}${found.path === '' ? '' : `.${found.path}`}`;
        const problem = referenceProblem({
          found,
          manifest,
          contractCase,
          keyIndex,
          lastStep: part.lastStep,
        });
        if (problem !== undefined) problems.push(`${where}: ${problem}`);
      }
    }
  });
  return problems;
}

function referenceProblem({
  found,
  manifest,
  contractCase,
  keyIndex,
  lastStep,
}: {
  found: FoundReference;
  manifest: SandboxManifest;
  contractCase: ContractCase;
  keyIndex: ReadonlyMap<string, number>;
  lastStep: number;
}): string | undefined {
  const {reference, token} = found;
  if (reference === undefined) return `unknown reference ${token}`;
  if (reference.kind === 'marker') return undefined;
  if (reference.kind === 'steps') {
    const position = keyIndex.get(reference.key);
    if (position === undefined) return `${token} names a step key the case doesn't have`;
    if (position > lastStep) return `${token} reads a step that runs later`;
    return undefined;
  }
  if (reference.kind === 'target' && contractCase.kind !== 'error') {
    return `${token} is only for cases of kind \`error\``;
  }
  if (resolveManifestValue({manifest, reference}) === undefined) {
    return `${token} is not in sandbox.yaml`;
  }
  return undefined;
}

/**
 * Reports the references of the fixture reads in the manifest that cannot be resolved. A read
 * runs before any case, so it may use `$fixture` and nothing else.
 */
export function checkManifestReferences(manifest: SandboxManifest): string[] {
  const reads = Object.entries(manifest).flatMap(([provider, sandbox]) =>
    Object.entries(sandbox.fixtures).flatMap(([name, fixture]) =>
      fixture.read === undefined
        ? []
        : [{where: `${provider}.fixtures.${name}.read`, ...fixture.read}],
    ),
  );
  return reads.flatMap(({where, ...read}) =>
    findContractReferences({with: read.with, expect: read.expect}).flatMap((found) => {
      const problem = fixtureReadProblem({found, manifest});
      return problem === undefined
        ? []
        : [`${where}${found.path === '' ? '' : `.${found.path}`}: ${problem}`];
    }),
  );
}

function fixtureReadProblem({
  found,
  manifest,
}: {
  found: FoundReference;
  manifest: SandboxManifest;
}): string | undefined {
  const {reference, token} = found;
  if (reference === undefined) return `unknown reference ${token}`;
  if (reference.kind !== 'fixture') return `${token} is not available in a fixture read`;
  if (resolveManifestValue({manifest, reference}) === undefined) {
    return `${token} is not in sandbox.yaml`;
  }
  return undefined;
}
