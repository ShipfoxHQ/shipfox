import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUNNER_BASE_IMAGE_OS} from './metadata.js';

const RECIPE_VERSION = 1;
const UBUNTU_RELEASE = 'noble';
const PACKER_TEMPLATE_PATTERN = /\.pkr\.hcl$/u;
const MISE_PACKER_PIN_PATTERN = /^packer\s*=\s*"([^"]+)"\s*$/mu;
const MISE_NODE_PIN_PATTERN = /^"?node"?\s*=\s*"([^"]+)"\s*$/mu;
// Scripts that run on the base or verify it. Package tooling, tests, and docs stay out.
const RECIPE_SCRIPT_DIRECTORIES = ['scripts/build', 'scripts/verify'] as const;

export interface RunnerBaseRecipeFile {
  path: string;
  sha256: string;
}

export interface RunnerBaseRecipe {
  digest: string;
  imageOs: string;
  ubuntuRelease: string;
  packerVersion: string;
  nodeVersion: string;
  files: RunnerBaseRecipeFile[];
}

export interface RunnerBaseRecipeOptions {
  packageRoot?: string;
  miseConfigPath?: string;
}

// The digest identifies base compatibility. The base installs Node, so its pin counts with the
// base's own templates and scripts and the Packer pin. pnpm and application changes must not
// invalidate a base. Plugin pins and storage settings live in the hashed templates.
export function computeRunnerBaseRecipe(options: RunnerBaseRecipeOptions = {}): RunnerBaseRecipe {
  const packageRoot = options.packageRoot ?? fileURLToPath(new URL('..', import.meta.url));
  const miseConfigPath = options.miseConfigPath ?? resolve(packageRoot, '../../../mise.toml');
  const files = recipeFilePaths(packageRoot).map((path) => ({
    path,
    sha256: sha256(readFileSync(join(packageRoot, path))),
  }));
  const miseConfig = readFileSync(miseConfigPath, 'utf8');
  const inputs = {
    recipeVersion: RECIPE_VERSION,
    imageOs: RUNNER_BASE_IMAGE_OS,
    ubuntuRelease: UBUNTU_RELEASE,
    packerVersion: readPackerVersion(miseConfig),
    nodeVersion: readNodeVersion(miseConfig),
    files,
  };
  return {
    digest: `sha256:${sha256(JSON.stringify(inputs))}`,
    imageOs: inputs.imageOs,
    ubuntuRelease: inputs.ubuntuRelease,
    packerVersion: inputs.packerVersion,
    nodeVersion: inputs.nodeVersion,
    files,
  };
}

export function readPackerVersion(miseConfig: string): string {
  const version = MISE_PACKER_PIN_PATTERN.exec(miseConfig)?.[1];
  if (!version) throw new Error('mise.toml does not pin packer.');
  return version;
}

export function readNodeVersion(miseConfig: string): string {
  const version = MISE_NODE_PIN_PATTERN.exec(miseConfig)?.[1];
  if (!version) throw new Error('mise.toml does not pin node.');
  return version;
}

function recipeFilePaths(packageRoot: string): string[] {
  const templates = readdirSync(packageRoot, {withFileTypes: true})
    .filter((entry) => entry.isFile() && PACKER_TEMPLATE_PATTERN.test(entry.name))
    .map((entry) => entry.name);
  const scripts = RECIPE_SCRIPT_DIRECTORIES.flatMap((directory) =>
    listFiles(join(packageRoot, directory)).map((path) => relative(packageRoot, path)),
  );
  const paths = [...templates, ...scripts].map((path) => path.split(sep).join('/')).sort();
  if (!templates.length) throw new Error(`No Packer templates found in ${packageRoot}.`);
  return paths;
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function runRunnerBaseRecipeCli(): void {
  process.stdout.write(`${JSON.stringify(computeRunnerBaseRecipe(), null, 2)}\n`);
}
