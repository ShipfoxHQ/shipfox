import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export interface ClientArchitectureViolation {
  file: string;
  occurrences: number;
  rule:
    | 'api-request-outside-adapter'
    | 'non-owning-feature-contribution'
    | 'private-feature-import'
    | 'unchecked-route-search'
    | 'inline-query-policy'
    | 'query-policy-outside-adapter'
    | 'unmapped-api-response'
    | 'unparsed-api-response';
}

export interface ClientArchitectureInventory {
  adapterFiles: string[];
  checkedApiRequestCalls: number;
  queryHooks: number;
  reusableQueryPolicies: number;
}

/**
 * Narrow exceptions must name the owning file and explain the state that the
 * shared query-options convention cannot safely represent.
 */
export const clientArchitectureExceptions = {
  queryPolicy: {
    'libs/client/logs/src/hooks/api/step-logs.ts':
      'The query merges a prior cursor snapshot and owns a per-view retry lifecycle.',
  },
} as const;

const rootDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const auditedDirectories = [
  path.join(rootDirectory, 'libs/client'),
  path.join(rootDirectory, 'libs/shared/react/ui'),
];
const sourceFilePattern = /\.(?:ts|tsx)$/;
const nonProductionSourcePattern = /\.(?:stories|test)\.(?:ts|tsx)$/;
const apiRequestPattern = /\b(?:apiRequest|checkedApiRequest)\s*(?:<[^>]*>)?\s*\(/;
const uncheckedApiRequestPattern = /\bapiRequest\s*(?:<[^>]*>)?\s*\(/;
const checkedApiRequestCallPattern = /\bcheckedApiRequest\s*(?:<[^>]*>)?\s*\(/g;
const unmappedApiResponsePattern =
  /(?:\breturn\s*(?:\(\s*)?|=>\s*(?:\(\s*)?)(?:await\s+)?checkedApiRequest\s*(?:<[^>]*>)?\s*\((?!\s*emptyResponseSchema\b)/g;
const queryHookPattern = /\b(?:useQuery|useInfiniteQuery)\s*(?:<[^>]*>)?\s*\(/g;
const queryPolicyPattern =
  /(?:\.\.\.\s*)?(?:[A-Za-z_$][\w$]*QueryOptions|queryOptions|infiniteQueryOptions)\s*\(/;
const routeSearchPattern = /\buseRouteSearch\s*\(/;
const identifierStartPattern = /[A-Za-z_$]/;
const identifierPartPattern = /[A-Za-z0-9_$]/;
const regexFlagPattern = /[A-Za-z]/;
const whitespacePattern = /\s/;
const digitPattern = /[0-9]/;
const regexLiteralPrefixKeywords = new Set([
  'await',
  'case',
  'catch',
  'delete',
  'do',
  'else',
  'for',
  'if',
  'in',
  'instanceof',
  'of',
  'return',
  'switch',
  'throw',
  'typeof',
  'void',
  'while',
  'with',
  'yield',
]);
const excludedDirectoryNames = new Set([
  'dist',
  'node_modules',
  'test',
  'tests',
  '__tests__',
  'fixtures',
  '__fixtures__',
  'generated',
  '__generated__',
]);
const privateFeatureImportPattern =
  /(?:from\s+|import\s*\(\s*)['"]@shipfox\/client-[^/'"]+\/(?!feature(?:\/|['"])|routes(?:\/|['"])|continuation(?:\/|['"])|runtime(?:\/|['"])|testing(?:\/|['"])|vite(?:\/|['"]))(?:[^'"]+)['"]/;
const featureManifestPathPattern = /^libs\/client\/([^/]+)\/src\/feature\.ts$/u;
const featureDeclarationPattern = /defineClientFeature\(\s*\{\s*id\s*:\s*['"]([^'"]+)['"]/u;
const featureIdPattern = /\bid\s*:\s*['"]([^'"]+)['"]/u;
const coordinatorPattern = /\bcoordinator\s*:\s*['"]([^'"]+)['"]/u;
const routeImplementationPattern = /\bimpl\s*:\s*['"](@shipfox\/client-[^/'"]+)\/routes\//gu;
const routePathPattern = /\bpath\s*:\s*['"]([^'"]+)['"]/gu;
const navigationTargetPattern = /\bto\s*:\s*['"]([^'"]+)['"]/gu;
const settingsPathPattern = /\bpathSegment\s*:\s*['"]([^'"]+)['"]/gu;
const registryDefinitionPattern = /\b(?:navigation|settingsSections)\s*(?::|=)\s*\[/u;
const trailingSlashPattern = /\/+$/u;
const generatedFilePattern = /\.gen\.(?:ts|tsx)$/;

function toRepositoryPath(filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/');
}

export async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return excludedDirectoryNames.has(entry.name) ? [] : await sourceFiles(entryPath);
      }
      return sourceFilePattern.test(entry.name) &&
        !nonProductionSourcePattern.test(entry.name) &&
        !generatedFilePattern.test(entry.name)
        ? [entryPath]
        : [];
    }),
  );
  return files.flat();
}

function countMatches(source: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].length;
}

function capturedMatches(source: string, pattern: RegExp): string[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return [...source.matchAll(new RegExp(pattern.source, flags))].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

function normalizeManifestPath(value: string): string {
  return value === '/' ? value : value.replace(trailingSlashPattern, '') || '/';
}

function featureContributionOccurrences(file: string, source: string): number {
  const manifest = file.match(featureManifestPathPattern);
  if (!manifest) return registryDefinitionPattern.test(source) ? 1 : 0;

  const packageName = `@shipfox/client-${manifest[1]}`;
  const featureId =
    source.match(featureDeclarationPattern)?.[1] ?? source.match(featureIdPattern)?.[1];
  const coordinatorId = source.match(coordinatorPattern)?.[1];
  const hasExplicitCoordinator = featureId !== undefined && coordinatorId === featureId;
  let occurrences = featureId === `shipfox.${manifest[1]}` ? 0 : 1;

  for (const implementationPackage of capturedMatches(source, routeImplementationPattern)) {
    if (implementationPackage !== packageName && !hasExplicitCoordinator) occurrences += 1;
  }

  const routes = new Set(capturedMatches(source, routePathPattern).map(normalizeManifestPath));
  for (const target of capturedMatches(source, navigationTargetPattern)) {
    if (!routes.has(normalizeManifestPath(target)) && !hasExplicitCoordinator) occurrences += 1;
  }
  for (const segment of capturedMatches(source, settingsPathPattern)) {
    const target = normalizeManifestPath(`/workspaces/$wid/settings/${segment}`);
    if (!routes.has(target) && !hasExplicitCoordinator) occurrences += 1;
  }

  return occurrences;
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && identifierStartPattern.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && identifierPartPattern.test(character);
}

function findRegexLiteralEnd(source: string, start: number): number {
  let inCharacterClass = false;
  let escaped = false;

  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '\n' || character === '\r') return source.length;
    if (character === '[') {
      inCharacterClass = true;
      continue;
    }
    if (character === ']') {
      inCharacterClass = false;
      continue;
    }
    if (character === '/' && !inCharacterClass) {
      let end = index + 1;
      while (regexFlagPattern.test(source[end] ?? '')) end += 1;
      return end;
    }
  }
  return source.length;
}

function findMatchingCallEnd(source: string, openParen: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let canEndExpression = false;

  for (let index = openParen; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
        canEndExpression = true;
      }
      continue;
    }
    if (whitespacePattern.test(character ?? '')) continue;
    if (character === '/' && nextCharacter === '/') {
      const newline = source.indexOf('\n', index + 2);
      if (newline === -1) return source.length;
      index = newline;
      continue;
    }
    if (character === '/' && nextCharacter === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      if (commentEnd === -1) return source.length;
      index = commentEnd + 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      escaped = false;
      canEndExpression = false;
      continue;
    }
    if (character === '/' && !canEndExpression) {
      index = findRegexLiteralEnd(source, index) - 1;
      canEndExpression = true;
      continue;
    }
    if (isIdentifierStart(character)) {
      let end = index + 1;
      while (isIdentifierPart(source[end])) end += 1;
      canEndExpression = !regexLiteralPrefixKeywords.has(source.slice(index, end));
      index = end - 1;
      continue;
    }
    if (digitPattern.test(character ?? '')) {
      canEndExpression = true;
      continue;
    }
    if (character === '(') {
      depth += 1;
      canEndExpression = false;
      continue;
    }
    if (character === ')' && --depth === 0) return index;
    if (character === ')') {
      canEndExpression = true;
      continue;
    }
    if (character === ']' || character === '}') {
      canEndExpression = true;
      continue;
    }
    if (character === '+' || character === '-') {
      if (nextCharacter === character) {
        index += 1;
        canEndExpression = true;
      } else {
        canEndExpression = false;
      }
      continue;
    }
    canEndExpression = false;
  }
  return source.length;
}

function queryHookCalls(source: string): Array<{hasPolicy: boolean}> {
  return [...source.matchAll(new RegExp(queryHookPattern.source, 'g'))].map((match) => {
    const start = match.index ?? 0;
    const openParen = start + match[0].lastIndexOf('(');
    const end = findMatchingCallEnd(source, openParen);
    const argumentsSource = source.slice(openParen + 1, end);
    return {hasPolicy: queryPolicyPattern.test(argumentsSource)};
  });
}

function hasQueryPolicyException(file: string): boolean {
  return Object.hasOwn(clientArchitectureExceptions.queryPolicy, file);
}

function validateExceptionRegistry(files: string[]): void {
  const fileSet = new Set(files);
  for (const [file, reason] of Object.entries(clientArchitectureExceptions.queryPolicy)) {
    if (!reason.trim()) throw new Error(`Client architecture exception has no reason: ${file}`);
    if (!fileSet.has(file))
      throw new Error(`Client architecture exception file is not audited: ${file}`);
  }
}

export function inventoryClientSource(
  file: string,
  source: string,
): {
  isAdapter: boolean;
  checkedApiRequestCalls: number;
  queryHooks: number;
  reusableQueryPolicies: number;
} {
  const normalizedFile = file.split(path.sep).join('/');
  const isAdapter = normalizedFile.includes('/src/hooks/api/');
  const calls = queryHookCalls(source);
  const reusableQueryPolicies = calls.filter((call) => call.hasPolicy).length;
  return {
    isAdapter,
    checkedApiRequestCalls: countMatches(source, checkedApiRequestCallPattern),
    queryHooks: calls.length,
    reusableQueryPolicies,
  };
}

export function auditClientSource(file: string, source: string): ClientArchitectureViolation[] {
  const violations: ClientArchitectureViolation[] = [];
  const normalizedFile = file.split(path.sep).join('/');
  const isAdapter = normalizedFile.includes('/src/hooks/api/');
  const isClientApi = normalizedFile.startsWith('libs/client/api/');
  const addViolation = (rule: ClientArchitectureViolation['rule'], occurrences: number): void => {
    if (occurrences > 0) violations.push({file, rule, occurrences});
  };
  addViolation('private-feature-import', countMatches(source, privateFeatureImportPattern));
  addViolation(
    'non-owning-feature-contribution',
    featureContributionOccurrences(normalizedFile, source),
  );
  if (!isAdapter && !isClientApi)
    addViolation('api-request-outside-adapter', countMatches(source, apiRequestPattern));
  if (!isClientApi)
    addViolation('unparsed-api-response', countMatches(source, uncheckedApiRequestPattern));
  if (isAdapter && !isClientApi) {
    addViolation('unmapped-api-response', countMatches(source, unmappedApiResponsePattern));
    const queryCalls = queryHookCalls(source);
    if (!hasQueryPolicyException(normalizedFile)) {
      addViolation('inline-query-policy', queryCalls.filter((call) => !call.hasPolicy).length);
    }
  } else if (!isClientApi) {
    addViolation('query-policy-outside-adapter', queryHookCalls(source).length);
  }
  if (!normalizedFile.includes('/src/routes/'))
    addViolation('unchecked-route-search', countMatches(source, routeSearchPattern));
  return violations;
}

export async function inventoryRepository(): Promise<ClientArchitectureInventory> {
  const files = (await Promise.all(auditedDirectories.map(sourceFiles))).flat();
  validateExceptionRegistry(files.map(toRepositoryPath));
  const entries = await Promise.all(
    files.map(async (file) => ({
      file: toRepositoryPath(file),
      inventory: inventoryClientSource(toRepositoryPath(file), await readFile(file, 'utf8')),
    })),
  );
  return {
    adapterFiles: entries
      .filter(({inventory}) => inventory.isAdapter)
      .map(({file}) => file)
      .sort(),
    checkedApiRequestCalls: entries.reduce(
      (total, {inventory}) => total + inventory.checkedApiRequestCalls,
      0,
    ),
    queryHooks: entries.reduce((total, {inventory}) => total + inventory.queryHooks, 0),
    reusableQueryPolicies: entries.reduce(
      (total, {inventory}) => total + inventory.reusableQueryPolicies,
      0,
    ),
  };
}

export async function auditRepository(): Promise<ClientArchitectureViolation[]> {
  const files = (await Promise.all(auditedDirectories.map(sourceFiles))).flat();
  validateExceptionRegistry(files.map(toRepositoryPath));
  const violations = await Promise.all(
    files.map(async (file) =>
      auditClientSource(toRepositoryPath(file), await readFile(file, 'utf8')),
    ),
  );
  return violations
    .flat()
    .sort((left, right) =>
      `${left.file}:${left.rule}`.localeCompare(`${right.file}:${right.rule}`),
    );
}

async function main(): Promise<void> {
  const violations = await auditRepository();
  if (violations.length === 0) {
    const inventory = await inventoryRepository();
    process.stdout.write(
      `Client architecture audit passed with zero violations (${inventory.checkedApiRequestCalls} checked API calls, ${inventory.queryHooks} query hooks, ${inventory.reusableQueryPolicies} reusable query policies, ${inventory.adapterFiles.length} adapter files)\n`,
    );
    return;
  }
  process.stderr.write(`Client architecture audit found ${violations.length} violation(s)\n`);
  for (const violation of violations)
    process.stderr.write(`- ${violation.file}: ${violation.rule}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(`Client architecture audit failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
