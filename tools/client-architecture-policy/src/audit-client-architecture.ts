import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export interface ClientArchitectureViolation {
  file: string;
  occurrences: number;
  rule: 'api-request-outside-adapter' | 'unchecked-route-search' | 'unparsed-api-response';
}

const rootDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const auditedDirectories = [
  path.join(rootDirectory, 'libs/client'),
  path.join(rootDirectory, 'libs/shared/react/ui'),
];
const sourceFilePattern = /\.(?:ts|tsx)$/;
const nonProductionSourcePattern = /\.(?:stories|test)\.(?:ts|tsx)$/;
const apiRequestPattern = /\b(?:apiRequest|checkedApiRequest)\s*(?:<[^>]*>)?\s*\(/;
const uncheckedApiRequestPattern = /\bapiRequest\s*(?:<[^>]*>)?\s*\(/;
const routeSearchPattern = /\buseRouteSearch\s*\(/;
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

export function auditClientSource(file: string, source: string): ClientArchitectureViolation[] {
  const violations: ClientArchitectureViolation[] = [];
  const normalizedFile = file.split(path.sep).join('/');
  const isAdapter = normalizedFile.includes('/src/hooks/api/');
  const isClientApi = normalizedFile.startsWith('libs/client/api/');
  const addViolation = (rule: ClientArchitectureViolation['rule'], occurrences: number): void => {
    if (occurrences > 0) violations.push({file, rule, occurrences});
  };
  if (!isAdapter && !isClientApi)
    addViolation('api-request-outside-adapter', countMatches(source, apiRequestPattern));
  if (!isClientApi)
    addViolation('unparsed-api-response', countMatches(source, uncheckedApiRequestPattern));
  if (!normalizedFile.includes('/src/routes/'))
    addViolation('unchecked-route-search', countMatches(source, routeSearchPattern));
  return violations;
}

export async function auditRepository(): Promise<ClientArchitectureViolation[]> {
  const files = (await Promise.all(auditedDirectories.map(sourceFiles))).flat();
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
    process.stdout.write('Client architecture audit passed with zero violations\n');
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
