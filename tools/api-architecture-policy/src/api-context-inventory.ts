import {readdir, readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {apiContextExemptPaths, apiContextImplementationPaths} =
  require('../../../api-contexts.cjs') as {
    apiContextExemptPaths: Record<string, string[]>;
    apiContextImplementationPaths: Record<string, string[]>;
  };
const apiRoot = new URL('../../../libs/api/', import.meta.url);

interface ClassifiedPath {
  classification: string;
  packagePath: string;
}

interface PackageManifest {
  name?: unknown;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function classifiedPaths(): ClassifiedPath[] {
  return [
    ...Object.entries(apiContextImplementationPaths).flatMap(([context, paths]) =>
      paths.map((packagePath) => ({classification: `context:${context}`, packagePath})),
    ),
    ...Object.entries(apiContextExemptPaths).flatMap(([exemption, paths]) =>
      paths.map((packagePath) => ({classification: `exemption:${exemption}`, packagePath})),
    ),
  ];
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
    if (entries.length === 0)
      errors.push(`Unclassified API implementation package: ${packagePath}`);
    if (entries.length > 1)
      errors.push(`API implementation package has multiple classifications: ${packagePath}`);
  }

  for (const packagePath of classifications.keys()) {
    if (!packagePaths.includes(packagePath))
      errors.push(`Classified API package does not exist: ${packagePath}`);
  }

  return errors.sort(compareText);
}

async function findPackageJsonPaths(directory: string, relativeDirectory = ''): Promise<string[]> {
  const entries = await readdir(directory, {withFileTypes: true});
  const packageJsonPaths: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      packageJsonPaths.push(...(await findPackageJsonPaths(absolutePath, relativePath)));
    } else if (entry.name === 'package.json') {
      packageJsonPaths.push(relativePath);
    }
  }

  return packageJsonPaths;
}

function isApiImplementationPackage(manifest: PackageManifest): boolean {
  return (
    typeof manifest.name === 'string' &&
    (manifest.name === '@shipfox/annotations' || manifest.name.startsWith('@shipfox/api-')) &&
    !manifest.name.endsWith('-dto')
  );
}

export async function apiImplementationPackagePaths(): Promise<string[]> {
  const packageJsonPaths = await findPackageJsonPaths(fileURLToPath(apiRoot));
  const packagePaths = await Promise.all(
    packageJsonPaths.map(async (packageJsonPath) => {
      const manifestPath = new URL(`../../../libs/api/${packageJsonPath}`, import.meta.url);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifest;
      if (!isApiImplementationPackage(manifest)) return null;
      return `libs/api/${path.posix.dirname(packageJsonPath)}`;
    }),
  );
  return packagePaths
    .filter((packagePath): packagePath is string => packagePath !== null)
    .sort(compareText);
}

export async function auditRepository(): Promise<string[]> {
  return auditApiContextInventory(await apiImplementationPackagePaths());
}

async function main(): Promise<void> {
  const errors = await auditRepository();
  if (errors.length === 0) {
    process.stdout.write('API context inventory passed\n');
    return;
  }

  process.stderr.write(`API context inventory failed (${errors.length} errors)\n`);
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`API context inventory failed: ${message}\n`);
    process.exitCode = 1;
  });
}
