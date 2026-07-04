import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, posix, sep} from 'node:path';

/**
 * A package.json `imports` map resolves `#` subpath imports. SWC preserves those
 * specifiers verbatim, so a built `dist/index.js` keeps `#schemas/index.js`, which
 * the map points at `./src/*` and a plain Node ESM resolver (Playwright, a
 * dist-only image) cannot load because no `.js` exists under `src/`.
 *
 * SWC's own `jsc.paths` cannot fix this reliably: it rewrites `#dir/file.js` but
 * leaves a broken `../#file.js` for top-level `#file.js` aliases. So after SWC
 * emits `dist/`, we rewrite every `#` specifier ourselves. Because
 * `--strip-leading-paths` mirrors the `src/` tree into `dist/`, a path resolved
 * against `src/` and made relative to the importing file is also valid in `dist/`.
 */

interface PackageJson {
  imports?: Record<string, unknown>;
}

// `from "#x"`, side-effect `import "#x"`, and dynamic `import("#x")`. A `#`
// string literal that is not a module specifier (e.g. a `#ffffff` color) has no
// `from`/`import` in front of it, so it is left untouched.
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(#[^"']+)\2/g;
const LEADING_DOT_SLASH = /^\.\//;

/**
 * Resolves a `#` specifier against the `imports` map to its target string
 * (e.g. `./src/slug.js`). Returns null when no string target applies, which
 * covers conditional (object) targets: those declare their own runtime
 * resolution and must not be rewritten.
 */
function resolveTarget(spec: string, imports: Record<string, unknown>): string | null {
  const exact = imports[spec];
  if (typeof exact === 'string') return exact;
  if (exact !== undefined) return null;

  let best: {resolved: string; prefixLength: number} | null = null;
  for (const [key, target] of Object.entries(imports)) {
    const star = key.indexOf('*');
    if (star === -1 || typeof target !== 'string') continue;

    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    const fits = spec.startsWith(prefix) && spec.endsWith(suffix);
    if (!fits || spec.length < prefix.length + suffix.length) continue;

    const captured = spec.slice(prefix.length, spec.length - suffix.length);
    if (!best || prefix.length > best.prefixLength) {
      best = {resolved: target.replace('*', captured), prefixLength: prefix.length};
    }
  }
  return best?.resolved ?? null;
}

// `./src/slug.js` -> `slug.js` (relative to the build output root). Normalizes
// first so a `#/foo.js`-style alias (which resolves to `./src//foo.js`) collapses
// like Node would. Returns null when the target is not under `rootDir`, so we
// never remap paths we cannot place in `dist/`.
function toOutputRelative(target: string, rootDir: string): string | null {
  const normalized = posix.normalize(target.replace(LEADING_DOT_SLASH, ''));
  const prefix = `${rootDir}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

/**
 * Rewrites the `#` specifiers of a single emitted file. `fileOutputPath` is the
 * file's path relative to the output root (which mirrors `src/`).
 */
export function rewriteSpecifiers(
  code: string,
  fileOutputPath: string,
  imports: Record<string, unknown>,
  rootDir: string,
): string {
  const fromDir = posix.dirname(fileOutputPath);
  return code.replace(SPECIFIER, (match, lead, quote, spec) => {
    const target = resolveTarget(spec, imports);
    if (target === null) return match;

    const outputTarget = toOutputRelative(target, rootDir);
    if (outputTarget === null) return match;

    const relativePath = posix.relative(fromDir, outputTarget);
    const specifier = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
    return `${lead}${quote}${specifier}${quote}`;
  });
}

interface RewriteHashImportsOptions {
  outputDir: string;
  projectRoot: string;
  rootDir?: string;
}

/**
 * Rewrites `#` subpath imports to relative paths across every emitted `.js` file,
 * so the built package loads under a plain Node ESM resolver. A no-op when the
 * package declares no `imports` map.
 */
export function rewriteHashImports({
  outputDir,
  projectRoot,
  rootDir = 'src',
}: RewriteHashImportsOptions): void {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as PackageJson;
  if (!pkg.imports) return;

  const entries = readdirSync(outputDir, {recursive: true});
  for (const entry of entries) {
    if (typeof entry !== 'string' || !entry.endsWith('.js')) continue;

    const absolutePath = join(outputDir, entry);
    const code = readFileSync(absolutePath, 'utf8');
    const outputPath = entry.split(sep).join('/');
    const rewritten = rewriteSpecifiers(code, outputPath, pkg.imports, rootDir);
    if (rewritten !== code) writeFileSync(absolutePath, rewritten);
  }
}
