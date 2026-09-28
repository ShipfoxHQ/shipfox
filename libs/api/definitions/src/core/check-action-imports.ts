import {stripTypeScriptTypes} from 'node:module';
import type {ActionBundleFile} from '@shipfox/workflow-document';
import {init, parse} from 'es-module-lexer';

const TYPESCRIPT_EXTENSIONS = ['.ts', '.mts'];
const JAVASCRIPT_EXTENSIONS = ['.js', '.mjs'];

export interface ActionImportIssue {
  code: 'action-import-unresolved';
  message: string;
  /** Importing file, relative to the action directory. */
  filePath: string;
  specifier: string;
}

/**
 * Reports static relative imports that do not resolve to a file of the action.
 * Bare specifiers resolve from the job workspace at run time, so they are not
 * checked, and neither are dynamic imports with computed specifiers.
 */
export async function checkActionImports(params: {
  files: readonly ActionBundleFile[];
}): Promise<ActionImportIssue[]> {
  await init;
  const paths = new Set(params.files.map((file) => file.path));
  const issues: ActionImportIssue[] = [];
  for (const file of params.files) {
    for (const specifier of relativeSpecifiers(file)) {
      const target = resolveInBundle({importer: file.path, specifier});
      if (target !== undefined && paths.has(target)) continue;
      const reason =
        target === undefined
          ? 'which is outside the action directory'
          : 'which is not in the action';
      issues.push({
        code: 'action-import-unresolved',
        message: `${file.path} imports ${specifier}, ${reason}`,
        filePath: file.path,
        specifier,
      });
    }
  }
  return issues;
}

function relativeSpecifiers(file: ActionBundleFile): string[] {
  const isTypeScript = TYPESCRIPT_EXTENSIONS.some((extension) => file.path.endsWith(extension));
  const isJavaScript = JAVASCRIPT_EXTENSIONS.some((extension) => file.path.endsWith(extension));
  if (!isTypeScript && !isJavaScript) return [];

  let imports: ReturnType<typeof parse>[0];
  try {
    // Stripping drops type-only imports, which never load at run time.
    const source = isTypeScript ? stripTypeScriptTypes(file.content) : file.content;
    [imports] = parse(source);
  } catch {
    // A file that does not parse fails in the runner's loader with Node's own
    // syntax error, which says more than this check could.
    return [];
  }

  return imports
    .map((entry) => entry.n)
    .filter(
      (specifier): specifier is string =>
        specifier !== undefined && (specifier.startsWith('./') || specifier.startsWith('../')),
    );
}

/** Returns the bundle path, or undefined when the specifier leaves the bundle. */
function resolveInBundle(params: {importer: string; specifier: string}): string | undefined {
  const segments = params.importer.split('/').slice(0, -1);
  for (const segment of params.specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') {
      segments.push(segment);
      continue;
    }
    if (segments.length === 0) return undefined;
    segments.pop();
  }
  return segments.join('/');
}
