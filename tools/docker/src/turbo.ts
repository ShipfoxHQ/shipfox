import {execSync} from 'node:child_process';
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {buildShellCommand, getProjectFilePath, getWorkspaceRootPath} from '@shipfox/tool-utils';

/**
 * Prepare the Docker build context for a node app the "build outside Docker,
 * ingest dist" way. `turbo prune` writes a self-contained workspace into `out/`,
 * then each pruned package's already-built (turbo-cached) `dist/` is overlaid
 * into `out/full/`. The image ingests those `dist/`s plus a real `node_modules`
 * and never recompiles TypeScript — `shipfox-swc` transpiles per file and does
 * not bundle, so the workspace `dist/`s are what the running app needs.
 */
export function setupContext(packageName: string) {
  const contextPath = getProjectFilePath('out');
  rmSync(contextPath, {recursive: true, force: true});

  const prune = buildShellCommand([
    'turbo',
    'prune',
    '--docker',
    '--out-dir',
    contextPath,
    packageName,
  ]);
  execSync(prune, {stdio: 'inherit'});

  overlayDist(join(contextPath, 'full'));
}

function overlayDist(prunedRoot: string) {
  const workspaceRoot = getWorkspaceRootPath();

  for (const packageJson of findPackageJsonFiles(prunedRoot)) {
    const packagePath = relative(prunedRoot, dirname(packageJson));
    if (!packagePath) continue;
    const source = join(workspaceRoot, packagePath, 'dist');
    if (!existsSync(source)) {
      // A package with a `build` script is expected to emit `dist/` (every build
      // here transpiles to `dist/`). A missing one means the build did not run,
      // so fail now instead of shipping an image that breaks at runtime.
      if (buildsToDist(join(workspaceRoot, packagePath, 'package.json')))
        throw new Error(
          `${packagePath} has no built dist/ at ${source}. Build the workspace before "shipfox-docker --setup-context".`,
        );
      continue;
    }
    cpSync(source, join(prunedRoot, packagePath, 'dist'), {recursive: true});
    productionizeSubpathImports(packageJson);
  }
}

/**
 * Point a package's `#*` subpath imports at the built `dist/` instead of the
 * `src/` TypeScript, in the pruned context only. The image runs `dist/` with
 * plain `node`, so `import '#core/run.js'` must resolve to `./dist/core/run.js`;
 * the source map `"#*": "./src/*"` resolves it to a `.ts` file the image does
 * not ship, which crashes with ERR_MODULE_NOT_FOUND.
 *
 * Done here, on the throwaway build context, rather than the two tempting spots:
 *  - Source package.json: `#*` has to stay the unconditional `./src/*`. It is an
 *    intra-package alias, and type-check / type-emit / tests all run against
 *    `src/` without activating the `development` condition, so a `default ->
 *    dist` map would resolve a package's own imports to its (not-yet-built)
 *    dist and fail type-checking (TS7016).
 *  - swc emit: `jsc.paths` + `resolveFully` rewrites `#dir/file.js` but silently
 *    leaves bare `#file.js` (e.g. `#config.js`) as-is, producing broken output
 *    with no error.
 *
 * Rewriting the map here leaves source/dev/test untouched and lets Node's own
 * subpath resolver do the work, just aimed at `dist/`. The `development` branch
 * is kept only for symmetry with each package's `exports`; the image runs the
 * `default` branch.
 */
function productionizeSubpathImports(packageJsonPath: string) {
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    imports?: Record<string, unknown>;
  };
  if (manifest.imports?.['#*'] !== './src/*') return;

  manifest.imports['#*'] = {development: './src/*', default: './dist/*'};
  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function buildsToDist(packageJsonPath: string): boolean {
  if (!existsSync(packageJsonPath)) return false;
  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return Boolean(manifest.scripts?.build);
}

function findPackageJsonFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    if (statSync(entryPath).isDirectory()) found.push(...findPackageJsonFiles(entryPath));
    else if (entry === 'package.json') found.push(entryPath);
  }
  return found;
}
