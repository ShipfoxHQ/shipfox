import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export interface ClientArchitectureViolation {
  file: string;
  occurrences: number;
  rule:
    | 'api-request-outside-adapter'
    | 'core-api-dto-import'
    | 'core-client-framework-import'
    | 'leaf-query-cache-ownership'
    | 'response-dto-in-presentation';
}

const rootDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const clientDirectory = path.join(rootDirectory, 'libs/client');
const baselinePath = path.join(
  rootDirectory,
  'tools/client-architecture-policy/client-architecture-baseline.json',
);
const sourceFilePattern = /\.(?:ts|tsx)$/;
const nonProductionSourcePattern = /\.(?:stories|test)\.(?:ts|tsx)$/;
const apiDtoImportPattern = /(?:from\s+|import\()['"]@shipfox\/api-[^'"]+-dto['"]/;
const clientFrameworkImportPattern =
  /from\s+['"](?:react(?:-dom)?|jotai|@tanstack\/[^'"]+|@shipfox\/client-(?:api|shell|ui)|@shipfox\/react-ui(?:\/[^'"]+)?)['"]/;
const apiRequestPattern = /\b(?:apiRequest|checkedApiRequest)\s*(?:<[^>]*>)?\s*\(/;
const queryCachePattern =
  /\b(?:useQueryClient\s*\(|queryClient\.(?:invalidateQueries|removeQueries|resetQueries|setQueriesData|setQueryData))/;
const responseDtoNamePattern = /\b[A-Za-z0-9_]+(?<!Body|Query)Dto\b/;
const generatedDirectoryNames = new Set(['dist', 'node_modules']);

function toRepositoryPath(filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/');
}

export async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return generatedDirectoryNames.has(entry.name) ? [] : await sourceFiles(entryPath);
      }
      return sourceFilePattern.test(entry.name) && !nonProductionSourcePattern.test(entry.name)
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

function responseDtoCount(names: string): number {
  return countMatches(names, responseDtoNamePattern);
}

function responseDtoImportCount(source: string): number {
  let count = 0;
  const imports = source.matchAll(
    /import(?:\s+type)?\s+([^;]+?)\s+from\s+['"]@shipfox\/api-[^'"]+-dto['"]/g,
  );
  for (const match of imports) {
    const names = match[1] ?? '';
    count += responseDtoCount(names);
  }
  const inlineImports = source.matchAll(
    /import\(['"]@shipfox\/api-[^'"]+-dto['"]\)\.([A-Za-z0-9_]+)/g,
  );
  for (const match of inlineImports) {
    const name = match[1] ?? '';
    count += responseDtoCount(name);
  }
  return count;
}

export function auditClientSource(file: string, source: string): ClientArchitectureViolation[] {
  const violations: ClientArchitectureViolation[] = [];
  const normalizedFile = file.split(path.sep).join('/');
  const isCore = normalizedFile.includes('/src/core/');
  const isAdapter = normalizedFile.includes('/src/hooks/api/');
  const isClientApi = normalizedFile.startsWith('libs/client/api/');
  const isPresentation =
    normalizedFile.includes('/src/pages/') || normalizedFile.includes('/src/components/');
  const addViolation = (rule: ClientArchitectureViolation['rule'], occurrences: number): void => {
    if (occurrences > 0) violations.push({file, rule, occurrences});
  };
  if (isCore) {
    addViolation('core-api-dto-import', countMatches(source, apiDtoImportPattern));
    addViolation(
      'core-client-framework-import',
      countMatches(source, clientFrameworkImportPattern),
    );
  }
  if (!isAdapter && !isClientApi)
    addViolation('api-request-outside-adapter', countMatches(source, apiRequestPattern));
  if (isPresentation) addViolation('response-dto-in-presentation', responseDtoImportCount(source));
  if (normalizedFile.includes('/src/components/'))
    addViolation('leaf-query-cache-ownership', countMatches(source, queryCachePattern));
  return violations;
}

export async function auditRepository(): Promise<ClientArchitectureViolation[]> {
  const files = await sourceFiles(clientDirectory);
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

export async function baselineViolations(): Promise<ClientArchitectureViolation[]> {
  return JSON.parse(await readFile(baselinePath, 'utf8')) as ClientArchitectureViolation[];
}

function violationKey(violation: ClientArchitectureViolation): string {
  return `${violation.file}:${violation.rule}`;
}

export function newViolations(
  violations: ClientArchitectureViolation[],
  baseline: ClientArchitectureViolation[],
): ClientArchitectureViolation[] {
  const baselineOccurrences = new Map(
    baseline.map((violation) => [violationKey(violation), violation.occurrences]),
  );
  return violations.filter(
    (violation) => violation.occurrences > (baselineOccurrences.get(violationKey(violation)) ?? 0),
  );
}

async function main(): Promise<void> {
  const [violations, baseline] = await Promise.all([auditRepository(), baselineViolations()]);
  const newEntries = newViolations(violations, baseline);
  if (newEntries.length === 0) {
    process.stdout.write(
      `Client architecture audit passed with ${baseline.length} baseline entries\n`,
    );
    return;
  }
  process.stderr.write(`Client architecture audit found ${newEntries.length} new violation(s)\n`);
  for (const violation of newEntries)
    process.stderr.write(`- ${violation.file}: ${violation.rule}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(`Client architecture audit failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
