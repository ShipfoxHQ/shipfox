import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {parse as parseYaml, stringify as stringifyYaml} from 'yaml';

const execFileAsync = promisify(execFile);

// mise shims pick the tool version from the working directory, so turbo and pnpm
// start from this tool's checkout and receive the target directory as an option.
const TOOL_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Root files prune copies that a frozen install and the bundle never read. Keeping
// them would change every action's source digest on each unrelated edit.
const UNUSED_ROOT_FILES = ['turbo.json', 'turbo.jsonc', '.gitignore'];

const DEPENDENCY_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const PRODUCTION_KINDS = ['dependencies', 'optionalDependencies'] as const;

export interface ResolvedDependency {
  name: string;
  version: string;
}

export interface BuildTree {
  directory: string;
  /** The external packages the production dependencies resolve to, sorted. */
  dependencies: ResolvedDependency[];
  remove: () => Promise<void>;
}

/**
 * Prunes the monorepo to one package and its production workspace dependencies,
 * trims the root files, and installs production dependencies from the trimmed
 * lockfile. The tree keeps the monorepo layout, so esbuild writes the same
 * relative module paths as a build inside the monorepo.
 */
export async function prepareBuildTree({
  root,
  workspaceName,
}: {
  root: string;
  workspaceName: string;
}): Promise<BuildTree> {
  const directory = await mkdtemp(join(tmpdir(), 'shipfox-registry-action-'));
  const remove = () => rm(directory, {recursive: true, force: true});
  try {
    await run('turbo', [
      '--cwd',
      root,
      'prune',
      workspaceName,
      '--production',
      '--out-dir',
      directory,
    ]);
    const lockfile = await trimBuildTree(directory);
    // pnpm 11 enforces `minimumReleaseAge` on frozen installs too, so the copied
    // workspace settings reject a dependency published too recently.
    await run('pnpm', [
      '--dir',
      directory,
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--prod',
    ]);
    return {directory, dependencies: productionDependencies(lockfile), remove};
  } catch (error) {
    await remove();
    throw error;
  }
}

async function trimBuildTree(directory: string): Promise<Lockfile> {
  const read = (file: string) => readFile(join(directory, file), 'utf8');
  const rootPackage = JSON.parse(await read('package.json'));
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify(trimRootPackageJson(rootPackage), null, 2)}\n`,
  );

  const trimmed = trimWorkspace({
    workspace: parseYaml(await read('pnpm-workspace.yaml')) ?? {},
    lockfile: parseYaml(await read('pnpm-lock.yaml')),
  });
  await writeFile(join(directory, 'pnpm-workspace.yaml'), stringifyYaml(trimmed.workspace));
  await writeFile(
    join(directory, 'pnpm-lock.yaml'),
    stringifyYaml(trimmed.lockfile, {lineWidth: 0}),
  );
  await Promise.all(UNUSED_ROOT_FILES.map((file) => rm(join(directory, file), {force: true})));
  return trimmed.lockfile;
}

export function trimRootPackageJson(rootPackage: Record<string, unknown>) {
  return {name: rootPackage.name, private: true, packageManager: rootPackage.packageManager};
}

interface LockfileImporter {
  dependencies?: Record<string, {specifier: string; version: string}>;
  devDependencies?: Record<string, {specifier: string; version: string}>;
  optionalDependencies?: Record<string, {specifier: string; version: string}>;
}

interface LockfileSnapshot {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export interface Lockfile {
  catalogs?: Record<string, Record<string, unknown>>;
  importers: Record<string, LockfileImporter>;
  packages?: Record<string, unknown>;
  snapshots?: Record<string, LockfileSnapshot>;
  [key: string]: unknown;
}

export interface WorkspaceSettings {
  catalog?: Record<string, string>;
  catalogs?: Record<string, Record<string, string>>;
  overrides?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Keeps the catalog entries the kept importers or `overrides` use, empties the
 * root importer, and drops lockfile entries no production dependency reaches.
 * Importers keep their devDependencies, because a frozen install compares them
 * with each `package.json`.
 */
export function trimWorkspace({
  workspace,
  lockfile,
}: {
  workspace: WorkspaceSettings;
  lockfile: Lockfile;
}): {workspace: WorkspaceSettings; lockfile: Lockfile} {
  const importers = {...lockfile.importers, '.': {}};
  const used = usedCatalogEntries({overrides: workspace.overrides ?? {}, importers});

  const defaultCatalog = keepUsed({used, catalog: 'default', entries: workspace.catalog ?? {}});
  const namedCatalogs = trimCatalogs({used, catalogs: workspace.catalogs ?? {}});
  const lockCatalogs = trimCatalogs({used, catalogs: lockfile.catalogs ?? {}});
  const snapshots = lockfile.snapshots ?? {};
  const reached = reachableSnapshots({importers, snapshots});
  const reachedPackages = new Set([...reached].map(withoutPeerSuffix));

  return {
    workspace: replaceEntries(workspace, {
      catalog: hasEntries(defaultCatalog) ? defaultCatalog : undefined,
      catalogs: hasEntries(namedCatalogs) ? namedCatalogs : undefined,
    }),
    lockfile: replaceEntries(lockfile, {
      catalogs: hasEntries(lockCatalogs) ? lockCatalogs : undefined,
      importers,
      packages: Object.fromEntries(
        Object.entries(lockfile.packages ?? {}).filter(([key]) => reachedPackages.has(key)),
      ),
      snapshots: Object.fromEntries(Object.entries(snapshots).filter(([key]) => reached.has(key))),
    }),
  };
}

/** The names each catalog must keep, by catalog name, from `catalog:` and `catalog:<name>` specifiers. */
function usedCatalogEntries({
  overrides,
  importers,
}: {
  overrides: Record<string, string>;
  importers: Record<string, LockfileImporter>;
}): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const use = (name: string, specifier: string) => {
    if (!specifier.startsWith('catalog:')) return;
    const catalog = specifier.slice('catalog:'.length) || 'default';
    used.set(catalog, (used.get(catalog) ?? new Set()).add(name));
  };
  for (const [name, specifier] of Object.entries(overrides)) use(name, specifier);
  for (const importer of Object.values(importers)) {
    for (const kind of DEPENDENCY_KINDS) {
      for (const [name, {specifier}] of Object.entries(importer[kind] ?? {})) use(name, specifier);
    }
  }
  return used;
}

function keepUsed<Entry>({
  used,
  catalog,
  entries,
}: {
  used: Map<string, Set<string>>;
  catalog: string;
  entries: Record<string, Entry>;
}): Record<string, Entry> {
  return Object.fromEntries(
    Object.entries(entries).filter(([name]) => used.get(catalog)?.has(name)),
  );
}

function trimCatalogs<Entry>({
  used,
  catalogs,
}: {
  used: Map<string, Set<string>>;
  catalogs: Record<string, Record<string, Entry>>;
}): Record<string, Record<string, Entry>> {
  return Object.fromEntries(
    Object.entries(catalogs).flatMap(([catalog, entries]) => {
      const kept = keepUsed({used, catalog, entries});
      return hasEntries(kept) ? [[catalog, kept]] : [];
    }),
  );
}

/** The snapshot keys the importers' production dependencies reach, transitively. */
function reachableSnapshots({
  importers,
  snapshots,
}: {
  importers: Record<string, LockfileImporter>;
  snapshots: Record<string, LockfileSnapshot>;
}): Set<string> {
  const reached = new Set<string>();
  const visit = (name: string, version: string) => {
    if (version.startsWith('link:')) return;
    const key = `${name}@${version}`;
    if (reached.has(key)) return;
    reached.add(key);
    const snapshot = snapshots[key] ?? {};
    const dependencies = {...snapshot.dependencies, ...snapshot.optionalDependencies};
    for (const [dependency, resolved] of Object.entries(dependencies)) visit(dependency, resolved);
  };
  for (const importer of Object.values(importers)) {
    for (const kind of PRODUCTION_KINDS) {
      for (const [name, {version}] of Object.entries(importer[kind] ?? {})) visit(name, version);
    }
  }
  return reached;
}

/** The external packages of a trimmed lockfile, by name and version. */
export function productionDependencies(lockfile: Lockfile): ResolvedDependency[] {
  return Object.keys(lockfile.packages ?? {})
    .map((key) => {
      // A scoped name starts with `@`, so the separator is the first `@` after it.
      const separator = key.indexOf('@', 1);
      return {name: key.slice(0, separator), version: key.slice(separator + 1)};
    })
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.version, b.version));
}

// Snapshot keys carry peer contexts, as in `react-dom@19.1.1(react@19.1.1)`; package keys do not.
function withoutPeerSuffix(key: string): string {
  const peers = key.indexOf('(');
  return peers === -1 ? key : key.slice(0, peers);
}

// Replaces the entries the original has, in its key order, and drops those replaced by `undefined`.
function replaceEntries<Value extends Record<string, unknown>>(
  original: Value,
  replacements: Record<string, unknown>,
): Value {
  return Object.fromEntries(
    Object.entries(original).flatMap(([key, value]) => {
      if (!(key in replacements)) return [[key, value]];
      return replacements[key] === undefined ? [] : [[key, replacements[key]]];
    }),
  ) as Value;
}

function hasEntries(record: object): boolean {
  return Object.keys(record).length > 0;
}

// Code-unit order, so the order never depends on the runtime locale.
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

async function run(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args, {cwd: TOOL_DIRECTORY, maxBuffer: 64 * 1024 * 1024});
  } catch (error) {
    const {stdout = '', stderr = ''} = error as {stdout?: string; stderr?: string};
    throw new Error(`${command} ${args.join(' ')} failed:\n${`${stdout}\n${stderr}`.trim()}`, {
      cause: error,
    });
  }
}
