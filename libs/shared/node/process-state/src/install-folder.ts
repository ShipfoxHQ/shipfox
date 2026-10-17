import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export interface InstallFolder {
  packageName: string;
  folder: string;
}

const NODE_MODULES_SEGMENT = `${sep}node_modules${sep}`;

/**
 * Resolves the package copy that owns a module. Installed copies are identified by the last
 * `node_modules/<package>` folder, so pnpm's virtual store paths collapse to the package root.
 * Workspace links resolve outside `node_modules`, so they use the nearest `package.json`.
 */
export function resolveInstallFolder(moduleUrl: string): InstallFolder {
  const file = fileURLToPath(moduleUrl);
  const modulesIndex = file.lastIndexOf(NODE_MODULES_SEGMENT);
  if (modulesIndex !== -1) {
    const afterModules = file.slice(modulesIndex + NODE_MODULES_SEGMENT.length).split(sep);
    const nameSegments = afterModules[0]?.startsWith('@') ? 2 : 1;
    const nameParts = afterModules.slice(0, nameSegments);
    return {
      packageName: nameParts.join('/'),
      folder: file.slice(0, modulesIndex + NODE_MODULES_SEGMENT.length) + nameParts.join(sep),
    };
  }
  return nearestPackage(dirname(file));
}

function nearestPackage(start: string): InstallFolder {
  let current = start;
  while (true) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      const {name} = JSON.parse(readFileSync(manifest, 'utf8')) as {name?: string};
      // A manifest without a name, such as dist/package.json with only "type", is not the package root.
      if (name) return {packageName: name, folder: current};
    }
    const parent = dirname(current);
    if (parent === current) return {packageName: start, folder: start};
    current = parent;
  }
}
