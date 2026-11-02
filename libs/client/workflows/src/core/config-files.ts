import type {ConfigFileEntry} from '@shipfox/client-projects';

/** Every config read stays under this folder, so it is also the root of the tree. */
export const CONFIG_ROOT = '.shipfox';

const TRAILING_SLASHES = /\/+$/u;

export interface ConfigTreeFolder {
  kind: 'folder';
  path: string;
  name: string;
  children: ConfigTreeNode[];
}

export interface ConfigTreeFile {
  kind: 'file';
  path: string;
  name: string;
  entry: ConfigFileEntry;
}

export type ConfigTreeNode = ConfigTreeFolder | ConfigTreeFile;

/** Builds the `.shipfox` folder from a flat file list, folders first, then by name. */
export function buildConfigTree(files: readonly ConfigFileEntry[]): ConfigTreeFolder {
  const root: ConfigTreeFolder = {
    kind: 'folder',
    path: CONFIG_ROOT,
    name: CONFIG_ROOT,
    children: [],
  };
  const folders = new Map<string, ConfigTreeFolder>([[CONFIG_ROOT, root]]);

  function folderAt(path: string): ConfigTreeFolder {
    const existing = folders.get(path);
    if (existing) return existing;
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    const folder: ConfigTreeFolder = {
      kind: 'folder',
      path,
      name: path.slice(parentPath.length + 1),
      children: [],
    };
    folderAt(parentPath).children.push(folder);
    folders.set(path, folder);
    return folder;
  }

  for (const entry of files) {
    if (!entry.path.startsWith(`${CONFIG_ROOT}/`)) continue;
    const parentPath = entry.path.slice(0, entry.path.lastIndexOf('/'));
    folderAt(parentPath).children.push({
      kind: 'file',
      path: entry.path,
      name: entry.path.slice(parentPath.length + 1),
      entry,
    });
  }

  for (const folder of folders.values()) folder.children.sort(compareTreeNodes);
  return root;
}

function compareTreeNodes(left: ConfigTreeNode, right: ConfigTreeNode): number {
  if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
  return left.name.localeCompare(right.name);
}

/** The folders that must be open for `path` to show, from the root down. */
export function configAncestorPaths(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

/** Reads a path from the URL. Anything outside `.shipfox` selects nothing. */
export function normalizeConfigPath(path: string | undefined): string | null {
  const trimmed = path?.replace(TRAILING_SLASHES, '') ?? '';
  if (trimmed === CONFIG_ROOT || trimmed.startsWith(`${CONFIG_ROOT}/`)) return trimmed;
  return null;
}

export type ConfigSelection =
  | {kind: 'none'}
  | {kind: 'folder'; path: string}
  | {kind: 'file'; path: string; entry: ConfigFileEntry}
  | {kind: 'missing'; path: string};

export function resolveConfigSelection(
  path: string | null,
  files: readonly ConfigFileEntry[],
): ConfigSelection {
  if (path === null) return {kind: 'none'};
  if (path === CONFIG_ROOT) return {kind: 'folder', path};
  const entry = files.find((file) => file.path === path);
  if (entry) return {kind: 'file', path, entry};
  if (files.some((file) => file.path.startsWith(`${path}/`))) return {kind: 'folder', path};
  return {kind: 'missing', path};
}

/** Why a file shows a notice instead of its code. */
export type ConfigFileProblem =
  | 'symlink'
  | 'submodule'
  | 'too-large'
  | 'not-text'
  | 'not-found'
  | 'read-failed';

/** Symbolic links and submodules aren't read, because the provider can't return them as text. */
export function configEntryProblem(entry: ConfigFileEntry): 'symlink' | 'submodule' | null {
  if (entry.type === 'symlink') return 'symlink';
  if (entry.type === 'submodule') return 'submodule';
  return null;
}

export function configReadProblem(errorCode: string | undefined): ConfigFileProblem {
  switch (errorCode) {
    case 'content-too-large':
    case 'file-too-large':
      return 'too-large';
    case 'binary-file-unsupported':
      return 'not-text';
    case 'file-not-found':
      return 'not-found';
    default:
      return 'read-failed';
  }
}

const CODE_LANGUAGES = new Map(
  Object.entries({
    yml: 'yaml',
    yaml: 'yaml',
    md: 'markdown',
    json: 'json',
    ts: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    sh: 'shellscript',
  }),
);

/** The highlighting language for a file, or null to show it as plain text. */
export function configFileLanguage(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return CODE_LANGUAGES.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

/** A history row shows one line, so only the subject of the message. */
export function commitSubject(message: string): string {
  return message.split('\n', 1)[0]?.trim() ?? '';
}
