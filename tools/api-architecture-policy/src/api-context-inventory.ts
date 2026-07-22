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

interface BaselineEntry {
  issue: string;
  owner: string;
  reason: string;
  violation: string;
}

const baseline: BaselineEntry[] = [
  ...[
    'libs/api/definitions/src/core/sync-definitions.test.ts:@shipfox/api-integration-core',
    'libs/api/definitions/src/temporal/activities/sync-activities.test.ts:@shipfox/api-integration-core',
    'libs/api/workflows/src/core/run-workflow.test.ts:@shipfox/api-definitions',
    'libs/api/workflows/src/core/step-config/materialize-job-execution-steps.test.ts:@shipfox/api-integration-core',
    'libs/api/workflows/src/core/step-config/materialize-workflow-model.test.ts:@shipfox/api-definitions',
    'libs/api/workflows/src/db/workflow-runs/run-create.test.ts:@shipfox/api-definitions',
    'libs/api/workflows/src/presentation/dto/checkout-token.test.ts:@shipfox/api-integration-core',
    'libs/api/workflows/src/presentation/routes/agent-runtime-config.test.ts:@shipfox/api-agent',
    'libs/api/workflows/src/presentation/routes/agent-runtime-config.test.ts:@shipfox/api-agent/core/resolve-runtime-credentials',
    'libs/api/workflows/test/globalSetup.ts:@shipfox/annotations',
    'libs/api/workflows/test/globalSetup.ts:@shipfox/api-agent',
    'libs/api/workflows/test/globalSetup.ts:@shipfox/api-runners',
  ].map((path) => ({
    issue: 'ENG-1148',
    owner: 'Definitions and Workflows test migration',
    reason:
      'Consumer test and setup coverage still composes peer implementations pending contract fakes.',
    violation: `import:${path}`,
  })),
  ...[
    'libs/api/integration/github:package.json:dependencies:@shipfox/api-workspaces',
    'libs/api/integration/jira:package.json:dependencies:@shipfox/api-workspaces',
    'libs/api/integration/linear:package.json:dependencies:@shipfox/api-workspaces',
    'libs/api/triggers:package.json:dependencies:@shipfox/api-projects',
    'libs/api/workflows:package.json:dependencies:@shipfox/api-projects',
  ].map((path) => ({
    issue: 'ENG-1143',
    owner: 'Contract location and stale-edge migration',
    reason:
      'The implementation edge is stale while the consumer migration moves to the explicit DTO subpath.',
    violation: `manifest:${path}`,
  })),
  ...[
    'libs/api/definitions:package.json:devDependencies:@shipfox/api-integration-core',
    'libs/api/workflows:package.json:dependencies:@shipfox/api-runners',
    'libs/api/workflows:package.json:devDependencies:@shipfox/annotations',
    'libs/api/workflows:package.json:devDependencies:@shipfox/api-agent',
    'libs/api/workflows:package.json:devDependencies:@shipfox/api-definitions',
    'libs/api/workflows:package.json:devDependencies:@shipfox/api-integration-core',
  ].map((path) => ({
    issue: 'ENG-1148',
    owner: 'Definitions and Workflows test migration',
    reason:
      'The manifest remains until consumer tests and setup stop depending on peer implementations.',
    violation: `manifest:${path}`,
  })),
  {
    issue: 'ENG-1143',
    owner: 'Contract location and stale-edge migration',
    reason: 'Projects still re-exports its synchronous contract from the DTO root.',
    violation: 'dto-export:libs/api/projects-dto:src/index.ts:root-inter-module',
  },
  {
    issue: 'ENG-1143',
    owner: 'Contract location and stale-edge migration',
    reason: 'Integrations still re-exports its synchronous contract from the DTO root.',
    violation: 'dto-export:libs/api/integration/core-dto:src/index.ts:root-inter-module',
  },
  {
    issue: 'ENG-1143',
    owner: 'Contract location and stale-edge migration',
    reason: 'Projects has not yet published the required inter-module subpath.',
    violation: 'dto-export:libs/api/projects-dto:package.json:missing-inter-module-entry',
  },
  {
    issue: 'ENG-1143',
    owner: 'Contract location and stale-edge migration',
    reason: 'Integrations has not yet published the required inter-module subpath.',
    violation: 'dto-export:libs/api/integration/core-dto:package.json:missing-inter-module-entry',
  },
];

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

function implementationByName(
  manifests: Map<string, PackageManifest>,
): Map<string, ClassifiedPath> {
  const result = new Map<string, ClassifiedPath>();
  const classifications = new Map(classifiedPaths().map((entry) => [entry.packagePath, entry]));
  for (const [packagePath, manifest] of manifests) {
    const classification = classifications.get(packagePath);
    if (classification?.classification === 'implementations' && manifest.name)
      result.set(manifest.name, classification);
  }
  return result;
}

function isBaselineViolation(violation: string): boolean {
  return baseline.some((entry) => entry.violation === violation);
}

function baselineErrors(): string[] {
  const violations = new Map<string, number>();
  const errors: string[] = [];
  for (const entry of baseline) {
    if (!entry.issue || !entry.owner || !entry.reason)
      errors.push(`Invalid architecture baseline entry: ${entry.violation}`);
    violations.set(entry.violation, (violations.get(entry.violation) ?? 0) + 1);
  }
  for (const [violation, count] of violations) {
    if (count > 1) errors.push(`Architecture baseline has duplicate entry: ${violation}`);
  }
  return errors;
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

  if (
    importer?.classification === 'implementations' &&
    target?.classification === 'implementations' &&
    importer.context !== target.context
  ) {
    if (sourceFile) errors.push(`Foreign implementation import: ${sourceFile}`);
    if (dependencyGroup) errors.push(`Foreign implementation manifest edge: ${dependencyGroup}`);
  }
  if (importer?.classification === 'dto' && dtoRootExportsInterModule && !dtoHasInterModuleEntry)
    errors.push('DTO root exports inter-module contract');
  return errors;
}

export async function auditRepository(): Promise<string[]> {
  const packagePaths = await repositoryPackagePaths();
  const manifests = await readManifests(packagePaths);
  const classifications = new Map(classifiedPaths().map((entry) => [entry.packagePath, entry]));
  const implementations = implementationByName(manifests);
  const errors = [...auditApiContextInventory(packagePaths), ...baselineErrors()];

  for (const [packagePath, manifest] of manifests) {
    const classification = classifications.get(packagePath);
    if (!classification) continue;
    for (const group of dependencyGroups) {
      for (const dependency of Object.keys(manifest[group] ?? {})) {
        const target = implementations.get(dependency);
        if (
          classification.classification === 'implementations' &&
          target &&
          target.context !== classification.context
        ) {
          const violation = `manifest:${packagePath}:package.json:${group}:${dependency}`;
          if (!isBaselineViolation(violation))
            errors.push(`Foreign implementation manifest edge: ${violation}`);
        }
        if (classification.classification === 'shared-semantic' && target) {
          const violation = `manifest:${packagePath}:package.json:${group}:${dependency}`;
          if (!isBaselineViolation(violation))
            errors.push(`Shared semantic implementation dependency: ${violation}`);
        }
      }
    }
    if (classification.classification === 'dto') {
      const indexPath = path.join(repositoryRoot, packagePath, 'src/index.ts');
      const indexSource = await readFile(indexPath, 'utf8');
      if (sourceReExportsInterModule(indexSource)) {
        const violation = `dto-export:${packagePath}:src/index.ts:root-inter-module`;
        if (!isBaselineViolation(violation))
          errors.push(`DTO root exports inter-module contract: ${violation}`);
      }
      if (sourceReExportsInterModule(indexSource) && !hasInterModuleEntry(manifest.exports)) {
        const violation = `dto-export:${packagePath}:package.json:missing-inter-module-entry`;
        if (!isBaselineViolation(violation))
          errors.push(`DTO contract has no explicit inter-module export: ${violation}`);
      }
    }
  }

  for (const [packagePath, classification] of classifications) {
    if (classification.classification !== 'implementations') continue;
    for (const sourceFile of await sourceFiles(packagePath)) {
      const source = await readFile(sourceFile, 'utf8');
      const relativeFile = toPosixPath(path.relative(repositoryRoot, sourceFile));
      for (const specifier of importSpecifiers(source)) {
        const target = implementations.get(
          specifier
            .split('/')
            .slice(0, specifier.startsWith('@') ? 2 : 1)
            .join('/'),
        );
        if (target && target.context !== classification.context) {
          const violation = `import:${relativeFile}:${specifier}`;
          if (!isBaselineViolation(violation))
            errors.push(`Foreign implementation import: ${violation}`);
        }
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
