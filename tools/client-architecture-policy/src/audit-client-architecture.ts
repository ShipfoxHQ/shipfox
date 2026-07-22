import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

export interface ClientArchitectureViolation {
  file: string;
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
const apiDtoImportPattern = /from\s+['"]@shipfox\/api-[^'"]+-dto['"]/;
const clientFrameworkImportPattern =
  /from\s+['"](?:react(?:-dom)?|jotai|@tanstack\/[^'"]+|@shipfox\/client-(?:api|shell|ui)|@shipfox\/react-ui(?:\/[^'"]+)?)['"]/;
const apiRequestPattern = /\bapiRequest\s*(?:<[^>]*>)?\s*\(/;
const queryCachePattern =
  /\b(?:useQueryClient\s*\(|queryClient\.(?:invalidateQueries|removeQueries|resetQueries|setQueriesData|setQueryData))/;
const responseDtoNamePattern = /\b[A-Za-z0-9_]+(?<!Body|Query)Dto\b/;

function toRepositoryPath(filePath: string): string {
  return path.relative(rootDirectory, filePath).split(path.sep).join('/');
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return await sourceFiles(entryPath);
      return sourceFilePattern.test(entry.name) && !nonProductionSourcePattern.test(entry.name)
        ? [entryPath]
        : [];
    }),
  );
  return files.flat();
}

function hasResponseDtoImport(source: string): boolean {
  const imports = source.matchAll(
    /import(?:\s+type)?\s+([^;]+?)\s+from\s+['"]@shipfox\/api-[^'"]+-dto['"]/g,
  );
  for (const match of imports) {
    const names = match[1] ?? '';
    if (responseDtoNamePattern.test(names)) return true;
  }
  return false;
}

export function auditClientSource(file: string, source: string): ClientArchitectureViolation[] {
  const violations: ClientArchitectureViolation[] = [];
  const normalizedFile = file.split(path.sep).join('/');
  const isCore = normalizedFile.includes('/src/core/');
  const isAdapter = normalizedFile.includes('/src/hooks/api/');
  const isClientApi = normalizedFile.startsWith('libs/client/api/');
  const isPresentation =
    normalizedFile.includes('/src/pages/') || normalizedFile.includes('/src/components/');
  if (isCore && apiDtoImportPattern.test(source))
    violations.push({file, rule: 'core-api-dto-import'});
  if (isCore && clientFrameworkImportPattern.test(source))
    violations.push({file, rule: 'core-client-framework-import'});
  if (!isAdapter && !isClientApi && apiRequestPattern.test(source))
    violations.push({file, rule: 'api-request-outside-adapter'});
  if (isPresentation && hasResponseDtoImport(source))
    violations.push({file, rule: 'response-dto-in-presentation'});
  if (normalizedFile.includes('/src/components/') && queryCachePattern.test(source))
    violations.push({file, rule: 'leaf-query-cache-ownership'});
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
  const baselineKeys = new Set(baseline.map(violationKey));
  return violations.filter((violation) => !baselineKeys.has(violationKey(violation)));
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
