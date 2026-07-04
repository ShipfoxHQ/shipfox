import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, posix, sep} from 'node:path';
import {type ParseOptions, parseSync} from '@swc/core';

interface PackageJson {
  imports?: Record<string, unknown>;
}

// Parse the emitted JS with the permissive TS grammar (a superset of what SWC
// emits) so we only ever touch real module specifiers.
const PARSE_OPTIONS: ParseOptions = {syntax: 'typescript', tsx: true};
const LEADING_DOT_SLASH = /^\.\//;

/**
 * Conditional targets declare their own runtime resolution, so only string
 * targets are safe to rewrite.
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
      best = {resolved: target.replaceAll('*', captured), prefixLength: prefix.length};
    }
  }
  return best?.resolved ?? null;
}

// Normalize before the prefix check so `#/foo.js` aliases collapse the same way
// Node would, and skip targets that cannot be placed in `dist/`.
function toOutputRelative(target: string, rootDir: string): string | null {
  const normalized = posix.normalize(target.replace(LEADING_DOT_SLASH, ''));
  const prefix = `${rootDir}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

function relativeSpecifier(
  spec: string,
  fromDir: string,
  imports: Record<string, unknown>,
  rootDir: string,
): string | null {
  const target = resolveTarget(spec, imports);
  if (target === null) return null;

  const outputTarget = toOutputRelative(target, rootDir);
  if (outputTarget === null) return null;

  const relativePath = posix.relative(fromDir, outputTarget);
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function parseModule(code: string, label: string): ReturnType<typeof parseSync> {
  try {
    return parseSync(code, PARSE_OPTIONS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`shipfox-swc: failed to parse ${label}: ${reason}`, {cause: error});
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface SpecifierLiteral {
  value: string;
  start: number;
  end: number;
}

// A `#` string literal in module-specifier position: a static import/export
// `source` or a dynamic `import()` argument. Anything else (a `#ffffff` color,
// import-like text inside a string or comment) is never in this position, so it
// is left untouched.
function collectHashSpecifiers(ast: {span: {start: number}}): SpecifierLiteral[] {
  const base = ast.span.start;
  const literals: SpecifierLiteral[] = [];

  const record = (node: unknown): void => {
    if (
      isRecord(node) &&
      node.type === 'StringLiteral' &&
      typeof node.value === 'string' &&
      node.value.startsWith('#') &&
      isRecord(node.span) &&
      typeof node.span.start === 'number' &&
      typeof node.span.end === 'number'
    ) {
      literals.push({value: node.value, start: node.span.start - base, end: node.span.end - base});
    }
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isRecord(node)) return;

    const importsSource =
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ExportNamedDeclaration';
    if (importsSource) record(node.source);

    const isDynamicImport =
      node.type === 'CallExpression' && isRecord(node.callee) && node.callee.type === 'Import';
    if (isDynamicImport && Array.isArray(node.arguments) && isRecord(node.arguments[0])) {
      record(node.arguments[0].expression);
    }

    for (const key of Object.keys(node)) visit(node[key]);
  };

  visit(ast);
  return literals;
}

export function rewriteSpecifiers(
  code: string,
  fileOutputPath: string,
  imports: Record<string, unknown>,
  rootDir: string,
): string {
  if (!code.includes('#')) return code;

  const fromDir = posix.dirname(fileOutputPath);
  const specifiers = collectHashSpecifiers(parseModule(code, fileOutputPath));

  // Splice from the end so earlier offsets stay valid as we rewrite.
  let result = code;
  for (const {value, start, end} of specifiers.sort((a, b) => b.start - a.start)) {
    const specifier = relativeSpecifier(value, fromDir, imports, rootDir);
    if (specifier === null) continue;

    const quote = code[start];
    result = result.slice(0, start) + quote + specifier + quote + result.slice(end);
  }

  // Fail closed: only ever emit a file we can still parse, so a splice bug
  // surfaces as a build error rather than a corrupt module.
  if (result !== code) parseModule(result, fileOutputPath);
  return result;
}

interface RewriteHashImportsOptions {
  outputDir: string;
  projectRoot: string;
  rootDir?: string;
}

/**
 * SWC preserves package `imports` aliases in emitted JS, and `jsc.paths` leaves
 * a broken `../#file.js` for top-level aliases. Dist-only consumers then try to
 * resolve `#` specifiers back to `src/`, where no emitted JS exists. Because
 * `--strip-leading-paths` mirrors `src/` into `dist/`, string `imports` targets
 * can be translated into relative specifiers after emit. The rewrite parses each
 * file and edits only real specifier literals, so import-like text in strings or
 * comments is left untouched.
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
