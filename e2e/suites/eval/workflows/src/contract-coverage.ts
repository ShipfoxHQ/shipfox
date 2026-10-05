import type {ToolGrant} from '@shipfox/actions/tool-grants';
import type {ContractFiles} from './contracts.js';

export type CatalogGrants = Readonly<Record<string, Readonly<Record<string, ToolGrant>>>>;

/** A tool, or one method of a method-family tool, that needs a case. */
export interface CatalogUnit {
  provider: string;
  tool: string;
  method?: string;
  kind: 'read' | 'write';
  /** `<provider>.<tool>`, plus `#<method>` for a method. It is the key backlog entries use. */
  key: string;
}

export interface BacklogSize {
  provider: string;
  kind: 'read' | 'write';
  count: number;
}

export interface ContractCoverage {
  /** Catalog gaps and contradictions in the contract files. Any entry fails the check. */
  problems: string[];
  /** Cases without `fake` in `modes`, so upstream CI does not run them yet. */
  pending: string[];
  backlog: BacklogSize[];
}

export function unitKey({
  provider,
  tool,
  method,
}: {
  provider: string;
  tool: string;
  method?: string | undefined;
}): string {
  return `${provider}.${tool}${method === undefined ? '' : `#${method}`}`;
}

/** Every tool of the catalog, with a method family expanded to one unit per method. */
export function catalogUnits(grants: CatalogGrants): CatalogUnit[] {
  const units: CatalogUnit[] = [];
  for (const [provider, tools] of Object.entries(grants)) {
    for (const [tool, grant] of Object.entries(tools)) {
      if (grant.methods === undefined) {
        units.push({provider, tool, kind: grant.sensitivity, key: unitKey({provider, tool})});
        continue;
      }
      for (const [method, kind] of Object.entries(grant.methods)) {
        units.push({provider, tool, method, kind, key: unitKey({provider, tool, method})});
      }
    }
  }
  return units;
}

interface Reference {
  provider: string;
  /** Left out, a reference names a whole provider. */
  tool?: string | undefined;
  method?: string | undefined;
}

function unknownReason({
  grants,
  reference,
  methodRequired,
}: {
  grants: CatalogGrants;
  reference: Reference;
  methodRequired: boolean;
}): string | undefined {
  const {provider, tool, method} = reference;
  const tools = grants[provider];
  if (tools === undefined) return `provider "${provider}" is not in the catalog`;
  if (tool === undefined) return undefined;
  const grant = tools[tool];
  if (grant === undefined) return `"${provider}.${tool}" is not in the catalog`;
  if (grant.methods === undefined) {
    return method === undefined ? undefined : `"${provider}.${tool}" has no methods`;
  }
  if (method === undefined) {
    return methodRequired ? `"${provider}.${tool}" needs one of its methods` : undefined;
  }
  return grant.methods[method] === undefined
    ? `"${provider}.${tool}" has no method "${method}"`
    : undefined;
}

function splitBacklogTool(tool: string): {provider: string; tool: string} {
  const dot = tool.indexOf('.');
  return {provider: tool.slice(0, dot), tool: tool.slice(dot + 1)};
}

interface Coverage {
  /** Unit key to the ids of the cases with a step on it. */
  covered: Map<string, string[]>;
  /** Unit key to the ids of the exemptions that name it. */
  exempt: Map<string, string[]>;
  problems: string[];
}

function addId({map, key, id}: {map: Map<string, string[]>; key: string; id: string}) {
  map.set(key, [...(map.get(key) ?? []), id]);
}

function collectCaseCoverage({grants, files}: {grants: CatalogGrants; files: ContractFiles}) {
  const covered = new Map<string, string[]>();
  const problems: string[] = [];
  for (const {id, definition} of files.cases) {
    const {provider} = definition;
    // An effect is only a read that proves a write, so it does not count as the read's case.
    const references = definition.steps.flatMap((step) => [
      {where: `step "${step.tool}"`, covers: true, reference: {provider, ...step}},
      ...(step.effect === undefined
        ? []
        : [
            {
              where: `effect "${step.effect.tool}"`,
              covers: false,
              reference: {provider, ...step.effect},
            },
          ]),
    ]);
    for (const {where, covers, reference} of references) {
      const reason = unknownReason({grants, reference, methodRequired: true});
      if (reason !== undefined) problems.push(`case ${id}: ${where} names ${reason}`);
      else if (covers) addId({map: covered, key: unitKey(reference), id});
    }
  }
  return {covered, problems};
}

function collectExemptions({
  grants,
  files,
  units,
}: {
  grants: CatalogGrants;
  files: ContractFiles;
  units: readonly CatalogUnit[];
}) {
  const exempt = new Map<string, string[]>();
  const problems: string[] = [];
  for (const {id, definition} of files.exemptions) {
    const {provider, exempt: target} = definition;
    const reason = unknownReason({
      grants,
      reference: {provider, tool: target.tool, method: target.method},
      methodRequired: false,
    });
    if (reason !== undefined) {
      problems.push(`exemption ${id}: names ${reason}`);
      continue;
    }
    for (const unit of units) {
      if (
        unit.provider === provider &&
        (target.tool === undefined || unit.tool === target.tool) &&
        (target.method === undefined || unit.method === target.method)
      ) {
        addId({map: exempt, key: unit.key, id});
      }
    }
  }
  return {exempt, problems};
}

function collectCoverage({
  grants,
  files,
  units,
}: {
  grants: CatalogGrants;
  files: ContractFiles;
  units: readonly CatalogUnit[];
}): Coverage {
  const cases = collectCaseCoverage({grants, files});
  const exemptions = collectExemptions({grants, files, units});
  return {
    covered: cases.covered,
    exempt: exemptions.exempt,
    problems: [...cases.problems, ...exemptions.problems],
  };
}

/** The units that have neither a case nor an exemption. */
export function uncoveredUnits({
  grants,
  files,
}: {
  grants: CatalogGrants;
  files: ContractFiles;
}): CatalogUnit[] {
  const units = catalogUnits(grants);
  const {covered, exempt} = collectCoverage({grants, files, units});
  return units.filter(({key}) => !covered.has(key) && !exempt.has(key));
}

function summarizeBacklog(files: ContractFiles): BacklogSize[] {
  const counts = new Map<string, BacklogSize>();
  for (const {tool, kind} of files.backlog.entries) {
    const {provider} = splitBacklogTool(tool);
    const key = `${provider}/${kind}`;
    counts.set(key, {provider, kind, count: (counts.get(key)?.count ?? 0) + 1});
  }
  return [...counts.values()].sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.kind.localeCompare(b.kind),
  );
}

function checkBacklog({
  grants,
  files,
  units,
  covered,
}: {
  grants: CatalogGrants;
  files: ContractFiles;
  units: readonly CatalogUnit[];
  covered: ReadonlyMap<string, string[]>;
}) {
  const unitsByKey = new Map(units.map((unit) => [unit.key, unit]));
  const backlogged = new Set<string>();
  const problems: string[] = [];
  for (const entry of files.backlog.entries) {
    const reference = {...splitBacklogTool(entry.tool), method: entry.method};
    const name = unitKey(reference);
    const reason = unknownReason({grants, reference, methodRequired: true});
    if (reason !== undefined) {
      problems.push(`backlog entry ${name} names ${reason}`);
      continue;
    }
    backlogged.add(name);
    if (covered.has(name))
      problems.push(`backlog entry ${name} now has a case, so remove the entry`);
    const unit = unitsByKey.get(name);
    if (unit !== undefined && unit.kind !== entry.kind) {
      problems.push(`backlog entry ${name} is a ${entry.kind}, but the catalog says ${unit.kind}`);
    }
  }
  const {entries, ceiling} = files.backlog;
  if (entries.length > ceiling) {
    problems.push(`the backlog has ${entries.length} entries, over its ceiling of ${ceiling}`);
  }
  return {backlogged, problems};
}

/**
 * Checks the contract files against the tool catalog: every tool and method has a case, an
 * exemption, or a backlog entry, and the three never contradict each other or the catalog.
 * A write counts as covered by any step on it for now. The effect rules come with round-trip cases.
 */
export function checkContractCoverage({
  grants,
  files,
}: {
  grants: CatalogGrants;
  files: ContractFiles;
}): ContractCoverage {
  const units = catalogUnits(grants);
  const {covered, exempt, problems} = collectCoverage({grants, files, units});

  for (const [key, exemptions] of exempt) {
    const cases = covered.get(key);
    if (cases !== undefined) {
      problems.push(
        `${key} has an exemption (${exemptions.join(', ')}) and a case (${cases.join(', ')})`,
      );
    }
  }

  const backlog = checkBacklog({grants, files, units, covered});
  problems.push(...backlog.problems);

  for (const unit of units) {
    if (covered.has(unit.key) || exempt.has(unit.key) || backlog.backlogged.has(unit.key)) continue;
    problems.push(`${unit.kind} ${unit.key} has no case, exemption, or backlog entry`);
  }

  return {
    problems,
    pending: files.cases
      .filter(({definition}) => !definition.modes.includes('fake'))
      .map(({id}) => id),
    backlog: summarizeBacklog(files),
  };
}
export function formatContractCoverageReport(coverage: ContractCoverage): string {
  const backlog = coverage.backlog.map(
    ({provider, kind, count}) => `  ${provider} ${kind}: ${count}`,
  );
  return [
    `Backlog: ${coverage.backlog.reduce((sum, {count}) => sum + count, 0)} entries`,
    ...backlog,
    `Pending cases (no fake mode): ${coverage.pending.length}`,
    ...coverage.pending.map((id) => `  ${id}`),
  ].join('\n');
}
