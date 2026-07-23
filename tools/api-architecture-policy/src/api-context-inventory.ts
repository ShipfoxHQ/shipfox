import {access, readdir, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {apiArchitectureEdgePolicy, architecturePackages} = require('../../../api-contexts.cjs') as {
  apiArchitectureEdgePolicy: Record<
    string,
    Record<
      string,
      {
        decision: 'allow' | 'same-context' | 'never';
        violation?: string;
      }
    >
  >;
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
const importViolationSuffixExpression = / import$/;

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

function architectureEdgeViolation(
  importer: ClassifiedPath,
  target: ClassifiedPath | undefined,
): string | undefined {
  if (!target) return undefined;
  const edge = apiArchitectureEdgePolicy[importer.classification]?.[target.classification];
  if (!edge) {
    throw new Error(
      `Missing API architecture edge policy decision: ${importer.classification} -> ${target.classification}`,
    );
  }
  if (
    edge.decision === 'allow' ||
    (edge.decision === 'same-context' && importer.context === target.context)
  )
    return undefined;
  return edge.violation;
}

function manifestViolation(
  importer: ClassifiedPath,
  target: ClassifiedPath | undefined,
): string | undefined {
  const violation = architectureEdgeViolation(importer, target);
  return violation?.replace(importViolationSuffixExpression, ' manifest edge');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}

function interModuleParityViolation(hasSource: boolean, hasExport: boolean): string | undefined {
  if (hasSource === hasExport) return undefined;
  return hasSource
    ? 'DTO inter-module source has no explicit package export'
    : 'DTO inter-module export has no source file';
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

function hasInterModuleEntry(exports: PackageManifest['exports']): boolean {
  return typeof exports === 'object' && exports !== null && './inter-module' in exports;
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
  dtoHasInterModuleEntry = false,
  dtoHasInterModuleSource = false,
  importerPath,
  targetPath,
}: {
  dependencyGroup?: (typeof dependencyGroups)[number];
  dtoHasInterModuleEntry?: boolean;
  dtoHasInterModuleSource?: boolean;
  importerPath: string;
  targetPath?: string;
}): string[] {
  const classifications = new Map(classifiedPaths().map((entry) => [entry.packagePath, entry]));
  const importer = classifications.get(importerPath);
  const target = targetPath ? classifications.get(targetPath) : undefined;
  const errors: string[] = [];

  if (importer) {
    const dependencyViolation = manifestViolation(importer, target);
    if (dependencyGroup && dependencyViolation)
      errors.push(`${dependencyViolation}: ${dependencyGroup}`);
  }
  if (importer?.classification === 'dto') {
    const parityViolation = interModuleParityViolation(
      dtoHasInterModuleSource,
      dtoHasInterModuleEntry,
    );
    if (parityViolation) errors.push(parityViolation);
  }
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
      const hasInterModuleSource = await fileExists(
        path.join(repositoryRoot, packagePath, 'src/inter-module.ts'),
      );
      const hasInterModuleExport = hasInterModuleEntry(manifest.exports);
      const parityViolation = interModuleParityViolation(
        hasInterModuleSource,
        hasInterModuleExport,
      );
      if (parityViolation) errors.push(`${parityViolation}: dto-export:${packagePath}`);
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
