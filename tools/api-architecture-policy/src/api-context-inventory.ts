import {readdir, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {architecturePackages} = require('../../../api-contexts.cjs') as {
  architecturePackages: Record<string, Record<string, string[]>>;
};
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const serverRoots = [
  'libs/api',
  'libs/shared/common',
  'libs/shared/expression',
  'libs/shared/node',
  'libs/shared/workflow',
];
const dependencyGroups = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
const importExpression =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const sourceFileExpression = /\.(?:[cm]?[jt]sx?)$/;

interface ClassifiedPath {
  classification: string;
  context?: string;
  packagePath: string;
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, unknown> | string;
  name?: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function classifiedPaths(): ClassifiedPath[] {
  return Object.entries(architecturePackages).flatMap(([classification, contexts]) =>
    Object.entries(contexts).flatMap(([context, paths]) =>
      paths.map((packagePath) => ({
        classification,
        ...(classification === 'implementations' ||
        classification === 'dto' ||
        classification === 'spi'
          ? {context}
          : {}),
        packagePath,
      })),
    ),
  );
}

function packagesByName(manifests: Map<string, PackageManifest>): Map<string, ClassifiedPath> {
  const result = new Map<string, ClassifiedPath>();
  const classifications = new Map(classifiedPaths().map((entry) => [entry.packagePath, entry]));
  for (const [packagePath, manifest] of manifests) {
    const classification = classifications.get(packagePath);
    if (classification && manifest.name) result.set(manifest.name, classification);
  }
  return result;
}

function packageName(specifier: string): string {
  return specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
}

function importViolation(
  importer: ClassifiedPath,
  target: ClassifiedPath | undefined,
): string | undefined {
  if (!target) return undefined;
  if (
    importer.classification === 'implementations' &&
    target.classification === 'implementations' &&
    importer.context !== target.context
  )
    return 'Foreign implementation import';
  if (importer.classification === 'dto' && target.classification === 'implementations')
    return 'DTO implementation import';
  if (importer.classification === 'dto' && target.classification === 'spi') return 'DTO SPI import';
  if (importer.classification === 'shared-semantic' && target.classification === 'implementations')
    return 'Shared semantic implementation import';
  if (importer.classification === 'shared-semantic' && target.classification === 'spi')
    return 'Shared semantic SPI import';
  if (
    importer.classification === 'implementations' &&
    target.classification === 'spi' &&
    importer.context !== target.context
  )
    return 'Foreign same-context SPI import';
  if (
    importer.classification === 'spi' &&
    target.classification === 'implementations' &&
    importer.context !== target.context
  )
    return 'Foreign SPI implementation import';
  return undefined;
}

function manifestViolation(
  importer: ClassifiedPath,
  target: ClassifiedPath | undefined,
): string | undefined {
  if (!target) return undefined;
  if (target.classification === 'implementations') {
    if (importer.classification === 'implementations' && importer.context !== target.context)
      return 'Foreign implementation manifest edge';
    if (importer.classification === 'dto') return 'DTO implementation manifest edge';
    if (importer.classification === 'shared-semantic')
      return 'Shared semantic implementation dependency';
    if (importer.classification === 'spi' && importer.context !== target.context)
      return 'Foreign SPI implementation manifest edge';
  }
  if (target.classification === 'spi') {
    if (importer.classification === 'dto') return 'DTO SPI manifest edge';
    if (importer.classification === 'shared-semantic') return 'Shared semantic SPI dependency';
  }
  if (
    importer.classification === 'implementations' &&
    target.classification === 'spi' &&
    importer.context !== target.context
  )
    return 'Foreign same-context SPI manifest edge';
  return undefined;
}

async function findPackagePaths(directory: string, relativeDirectory = ''): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const packagePaths: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory())
      packagePaths.push(...(await findPackagePaths(absolutePath, relativePath)));
    if (entry.name === 'package.json') packagePaths.push(path.posix.dirname(relativePath));
  }
  return packagePaths;
}

async function repositoryPackagePaths(): Promise<string[]> {
  const paths = await Promise.all(
    serverRoots.map(async (root) => {
      const relativePaths = await findPackagePaths(path.join(repositoryRoot, root));
      return relativePaths.map((relativePath) => path.posix.join(root, relativePath));
    }),
  );
  return paths.flat().sort(compareText);
}

async function readManifests(packagePaths: string[]): Promise<Map<string, PackageManifest>> {
  const manifests = await Promise.all(
    packagePaths.map(async (packagePath) => {
      const text = await readFile(path.join(repositoryRoot, packagePath, 'package.json'), 'utf8');
      return [packagePath, JSON.parse(text) as PackageManifest] as const;
    }),
  );
  return new Map(manifests);
}

function sourceReExportsInterModule(source: string): boolean {
  return source.includes('inter-module');
}

function hasInterModuleEntry(exports: PackageManifest['exports']): boolean {
  return typeof exports === 'object' && exports !== null && './inter-module' in exports;
}

async function sourceFiles(packagePath: string): Promise<string[]> {
  const directory = path.join(repositoryRoot, packagePath);
  const files: string[] = [];
  const visit = async (currentDirectory: string): Promise<void> => {
    const entries = await readdir(currentDirectory, {withFileTypes: true});
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage')
        continue;
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      if (entry.isFile() && sourceFileExpression.test(entry.name)) files.push(absolutePath);
    }
  };
  await visit(directory);
  return files;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(importExpression)) {
    const specifier = match[1] ?? match[2];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

export function apiContextPackagePaths(): string[] {
  return classifiedPaths()
    .map(({packagePath}) => packagePath)
    .sort(compareText);
}

export function auditApiContextInventory(packagePaths: string[]): string[] {
  const classifications = new Map<string, string[]>();
  const errors: string[] = [];
  for (const {classification, packagePath} of classifiedPaths()) {
    const entries = classifications.get(packagePath) ?? [];
    entries.push(classification);
    classifications.set(packagePath, entries);
  }
  for (const packagePath of packagePaths) {
    const entries = classifications.get(packagePath) ?? [];
    if (entries.length === 0) errors.push(`Unclassified server package: ${packagePath}`);
    if (entries.length > 1)
      errors.push(`Server package has multiple classifications: ${packagePath}`);
  }
  for (const packagePath of classifications.keys()) {
    if (!packagePaths.includes(packagePath))
      errors.push(`Classified server package does not exist: ${packagePath}`);
  }
  return errors.sort(compareText);
}

export function auditPolicyFixture({
  dependencyGroup,
  dtoHasInterModuleEntry = true,
  dtoRootExportsInterModule = false,
  importerPath,
  sourceFile,
  targetPath,
}: {
  dependencyGroup?: (typeof dependencyGroups)[number];
  dtoHasInterModuleEntry?: boolean;
  dtoRootExportsInterModule?: boolean;
  importerPath: string;
  sourceFile?: string;
  targetPath?: string;
}): string[] {
  const classifications = new Map(classifiedPaths().map((entry) => [entry.packagePath, entry]));
  const importer = classifications.get(importerPath);
  const target = targetPath ? classifications.get(targetPath) : undefined;
  const errors: string[] = [];

  if (importer) {
    const sourceViolation = importViolation(importer, target);
    if (sourceFile && sourceViolation) errors.push(`${sourceViolation}: ${sourceFile}`);
    const dependencyViolation = manifestViolation(importer, target);
    if (dependencyGroup && dependencyViolation)
      errors.push(`${dependencyViolation}: ${dependencyGroup}`);
  }
  if (importer?.classification === 'dto' && dtoRootExportsInterModule && !dtoHasInterModuleEntry)
    errors.push('DTO contract has no explicit inter-module export');
  return errors;
}

export async function auditRepository(): Promise<string[]> {
  const packagePaths = await repositoryPackagePaths();
  const manifests = await readManifests(packagePaths);
  const classifications = new Map(classifiedPaths().map((entry) => [entry.packagePath, entry]));
  const packages = packagesByName(manifests);
  const errors = auditApiContextInventory(packagePaths);

  for (const [packagePath, manifest] of manifests) {
    const classification = classifications.get(packagePath);
    if (!classification) continue;
    for (const group of dependencyGroups) {
      for (const dependency of Object.keys(manifest[group] ?? {})) {
        const violation = manifestViolation(classification, packages.get(dependency));
        if (violation) {
          errors.push(`${violation}: manifest:${packagePath}:package.json:${group}:${dependency}`);
        }
      }
    }
    if (classification.classification === 'dto') {
      const indexPath = path.join(repositoryRoot, packagePath, 'src/index.ts');
      const indexSource = await readFile(indexPath, 'utf8');
      if (sourceReExportsInterModule(indexSource) && !hasInterModuleEntry(manifest.exports)) {
        const violation = `dto-export:${packagePath}:package.json:missing-inter-module-entry`;
        errors.push(`DTO contract has no explicit inter-module export: ${violation}`);
      }
    }
  }

  for (const [packagePath, classification] of classifications) {
    for (const sourceFile of await sourceFiles(packagePath)) {
      const source = await readFile(sourceFile, 'utf8');
      const relativeFile = toPosixPath(path.relative(repositoryRoot, sourceFile));
      for (const specifier of importSpecifiers(source)) {
        const violation = importViolation(classification, packages.get(packageName(specifier)));
        if (violation) errors.push(`${violation}: import:${relativeFile}:${specifier}`);
      }
    }
  }

  return errors.sort(compareText);
}

async function main(): Promise<void> {
  const errors = await auditRepository();
  if (errors.length === 0) {
    process.stdout.write('API architecture policy passed\n');
    return;
  }
  process.stderr.write(`API architecture policy failed (${errors.length} errors)\n`);
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`API architecture policy failed: ${message}\n`);
    process.exitCode = 1;
  });
}
