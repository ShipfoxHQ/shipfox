import {resolveInstallFolder} from './install-folder.js';

export interface PackageCopy {
  installFolder: string;
  slotKeys: string[];
}

export interface DuplicateCopy {
  packageName: string;
  copies: PackageCopy[];
  /** True when every copy registered the same slot keys, so all copies read the same state. */
  sharesState: boolean;
}

interface Registry {
  /** Package name to install folder to slot keys. */
  packages: Map<string, Map<string, Set<string>>>;
  reported: boolean;
}

const REGISTRY_KEY = Symbol.for('@shipfox/node-process-state/registry/v1');

function registry(): Registry {
  const store = globalThis as unknown as Record<symbol, Registry | undefined>;
  store[REGISTRY_KEY] ??= {packages: new Map(), reported: false};
  return store[REGISTRY_KEY];
}

export function recordCopy(params: {slotKey: string; moduleUrl: string}): void {
  const {packageName, folder} = resolveInstallFolder(params.moduleUrl);
  const {packages, reported} = registry();
  const copies = packages.get(packageName) ?? new Map<string, Set<string>>();
  packages.set(packageName, copies);

  const isNewCopy = !copies.has(folder);
  const slotKeys = copies.get(folder) ?? new Set<string>();
  copies.set(folder, slotKeys);
  slotKeys.add(params.slotKey);

  if (reported && isNewCopy && copies.size > 1) {
    // The copies are still loading their modules, so they can't be compared for shared state yet.
    process.emitWarning(
      `${packageName} loaded from a second install folder after startup: ${[...copies.keys()].join(', ')}`,
      {code: 'SHIPFOX_DUPLICATE_PACKAGE_COPY'},
    );
  }
}

/**
 * Lists packages that are installed more than once in this process. Call it once startup has
 * loaded every module. Copies that register afterwards warn on their own.
 */
export function duplicatePackageCopies(): DuplicateCopy[] {
  const state = registry();
  state.reported = true;

  const duplicates: DuplicateCopy[] = [];
  for (const [packageName, copies] of state.packages) {
    if (copies.size < 2) continue;
    const entries = [...copies].map(([installFolder, keys]) => ({
      installFolder,
      slotKeys: [...keys].sort(),
    }));
    const signatures = new Set(entries.map((entry) => entry.slotKeys.join('\n')));
    duplicates.push({packageName, copies: entries, sharesState: signatures.size === 1});
  }
  return duplicates;
}
